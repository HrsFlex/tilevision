"""
Room layout detection service.

Uses HorizonNet (sunset1995/HorizonNet, CVPR'19) to predict room corners from
a 360° equirectangular panorama, then rasterizes per-surface masks by
ray-casting against the recovered cuboid.

Convention used throughout (matches the frontend PanoramaViewer):
    theta = (px / W) * 2π        # 0 at left edge, increases rightward
    phi   = (py / H) * π         # 0 at top (up), π at bottom (down)
    ray   = (sin(phi)*sin(theta),  cos(phi),  sin(phi)*cos(theta))
    world = (x = east, y = up, z = forward / toward seam)

Camera is at the origin with a prior height of 1.6 m above the floor.  The
HorizonNet scale is recovered from this prior plus the ratio of
ceiling/floor angles.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, asdict
from typing import Dict, Optional

import numpy as np
from PIL import Image

# --- Make vendored HorizonNet importable ----------------------------------

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.abspath(os.path.join(_THIS_DIR, "..", ".."))
_VENDOR_DIR = os.path.join(_BACKEND_DIR, "vendor", "horizon_net")
if _VENDOR_DIR not in sys.path:
    sys.path.insert(0, _VENDOR_DIR)

DEFAULT_CKPT = os.path.join(_BACKEND_DIR, "ckpt", "resnet50_rnn__st3d.pth")

# Lazy-imported because torch is heavy ------------------------------------

_torch = None
_hn_model_cls = None
_hn_utils = None
_hn_inference_fn = None
_loaded_model = None
_loaded_ckpt_path: Optional[str] = None


_hn_pano_edge = None
_hn_rotate_pano = None


def _lazy_import():
    global _torch, _hn_model_cls, _hn_utils, _hn_inference_fn
    global _hn_pano_edge, _hn_rotate_pano
    if _torch is None:
        import torch  # type: ignore
        from model import HorizonNet  # type: ignore
        from misc import utils as hn_utils  # type: ignore
        from inference import inference as hn_inference  # type: ignore
        from misc.pano_lsd_align import panoEdgeDetection, rotatePanorama  # type: ignore

        _torch = torch
        _hn_model_cls = HorizonNet
        _hn_utils = hn_utils
        _hn_inference_fn = hn_inference
        _hn_pano_edge = panoEdgeDetection
        _hn_rotate_pano = rotatePanorama


def align_panorama(pano_rgb: np.ndarray, q_error: float = 0.7, refine_iter: int = 3) -> np.ndarray:
    """VP-align an equirectangular panorama (HN preprocess).

    Input/output: uint8 RGB, any resolution.  HN's pano_lsd_align internally
    works on 1024x512, so we downsample, detect vanishing points, rotate the
    original-resolution image using the recovered VP, and return it.
    """
    _lazy_import()
    h, w = pano_rgb.shape[:2]
    small = np.array(
        Image.fromarray(pano_rgb).resize((1024, 512), Image.BICUBIC)
    )[..., :3]
    _, vp, _, _, _, _, _ = _hn_pano_edge(
        small, qError=q_error, refineIter=refine_iter
    )
    aligned = _hn_rotate_pano(pano_rgb.astype(np.float32) / 255.0, vp[2::-1])
    return np.clip(aligned * 255.0, 0, 255).astype(np.uint8)


def _get_model(ckpt_path: str):
    global _loaded_model, _loaded_ckpt_path
    _lazy_import()
    if _loaded_model is None or _loaded_ckpt_path != ckpt_path:
        device = _torch.device("cpu")
        net = _hn_utils.load_trained_model(_hn_model_cls, ckpt_path).to(device)
        net.eval()
        _loaded_model = net
        _loaded_ckpt_path = ckpt_path
    return _loaded_model


# --- Result type ----------------------------------------------------------

@dataclass
class LayoutResult:
    width_m: float
    depth_m: float
    height_m: float
    rotation_rad: float
    floor_polygon_m: list     # [[x, z], ...] in meters, frontend convention
    camera_height_m: float
    num_walls: int


# --- Step 1: HorizonNet inference ----------------------------------------

def detect_corners(
    panorama_path: str,
    ckpt_path: str = DEFAULT_CKPT,
    force_cuboid: bool = True,
):
    _lazy_import()
    img = Image.open(panorama_path).convert("RGB")
    if img.size != (1024, 512):
        img = img.resize((1024, 512), Image.BICUBIC)
    arr = np.array(img).transpose(2, 0, 1)
    x = _torch.FloatTensor(np.ascontiguousarray(arr[None] / 255.0))

    net = _get_model(ckpt_path)
    device = _torch.device("cpu")
    with _torch.no_grad():
        cor_id, z0, z1, _ = _hn_inference_fn(
            net=net,
            x=x,
            device=device,
            flip=False,
            rotate=[],
            visualize=False,
            force_cuboid=force_cuboid,
        )
    return np.asarray(cor_id, dtype=np.float64), float(z0), float(z1)


# --- Step 2: corners -> 3D layout ----------------------------------------

def cor_id_to_layout(
    cor_id: np.ndarray,
    camera_height_m: float = 1.6,
):
    """
    Convert cor_id (rows alternate ceiling/floor) into a floor polygon
    in (x, z) meters and absolute room height.

    Rays are computed in the frontend's convention so that the polygon
    can be used both for mask rendering here and for UV mapping in JS.
    """
    u_n = cor_id[:, 0]
    v_n = cor_id[:, 1]
    theta = u_n * 2.0 * np.pi
    phi = v_n * np.pi
    sin_phi = np.sin(phi)

    dx = sin_phi * np.sin(theta)
    dy = np.cos(phi)
    dz = sin_phi * np.cos(theta)

    ceil_idx = np.arange(0, len(cor_id), 2)
    floor_idx = np.arange(1, len(cor_id), 2)

    # Intersect each floor-corner ray with plane y = -camera_height_m.
    dy_f = dy[floor_idx]
    if np.any(dy_f >= -1e-6):
        raise ValueError("Floor corner rays don't point downward – check cor_id.")
    t_f = -camera_height_m / dy_f
    x_f = t_f * dx[floor_idx]
    z_f = t_f * dz[floor_idx]
    floor_polygon = np.stack([x_f, z_f], axis=-1)          # (N, 2)

    # Recover ceiling height from the matching ceiling-ray at the same (u).
    horiz_dist = np.sqrt(x_f ** 2 + z_f ** 2)
    phi_c = phi[ceil_idx]
    # Ceiling ray makes elevation angle (π/2 - phi_c) above horizon.
    # ceiling height above camera = horiz_dist * tan(π/2 - phi_c)
    cot_phi_c = np.cos(phi_c) / (np.sin(phi_c) + 1e-9)
    ceil_above_cam = float(np.mean(horiz_dist * cot_phi_c))
    room_height = camera_height_m + max(0.1, ceil_above_cam)

    return floor_polygon, room_height


def _bbox_metrics(floor_polygon: np.ndarray):
    """Return (width, depth, rotation) for the tightest oriented bounding box
    aligned with one of the polygon's edges – the conventional measure of a
    rectangular room."""
    N = len(floor_polygon)
    best = None
    for i in range(N):
        p1 = floor_polygon[i]
        p2 = floor_polygon[(i + 1) % N]
        theta = float(np.arctan2(p2[1] - p1[1], p2[0] - p1[0]))
        c, s = np.cos(-theta), np.sin(-theta)
        R = np.array([[c, -s], [s, c]])
        rotated = floor_polygon @ R.T
        xs, ys = rotated[:, 0], rotated[:, 1]
        w = float(xs.max() - xs.min())
        d = float(ys.max() - ys.min())
        area = w * d
        if best is None or area < best[0]:
            best = (area, w, d, theta)
    _, w, d, theta = best
    return w, d, theta


# --- Step 3: polygon -> per-surface masks --------------------------------

def _point_in_poly(xs: np.ndarray, ys: np.ndarray, poly: np.ndarray) -> np.ndarray:
    N = len(poly)
    inside = np.zeros(xs.shape, dtype=bool)
    j = N - 1
    for i in range(N):
        xi, yi = poly[i]
        xj, yj = poly[j]
        cond = ((yi > ys) != (yj > ys)) & (
            xs < (xj - xi) * (ys - yi) / (yj - yi + 1e-12) + xi
        )
        inside ^= cond
        j = i
    return inside


def render_masks(
    floor_polygon: np.ndarray,
    room_height_m: float,
    camera_height_m: float = 1.6,
    out_size=(4096, 2048),
) -> Dict[str, np.ndarray]:
    """Ray-cast an equirectangular map against the prism room.  Returns
    uint8 masks for floor, ceiling, wall_0, ..., wall_{N-1}."""
    W, H = out_size
    poly = np.asarray(floor_polygon, dtype=np.float64)
    N = len(poly)

    floor_y = -camera_height_m
    ceil_y = room_height_m - camera_height_m

    px = np.arange(W)
    py = np.arange(H)
    theta = ((px + 0.5) / W) * 2.0 * np.pi                 # (W,)
    phi = ((py + 0.5) / H) * np.pi                          # (H,)
    sin_phi = np.sin(phi)[:, None]                          # (H, 1)
    cos_phi = np.cos(phi)[:, None]                          # (H, 1)
    sin_t = np.sin(theta)[None, :]                          # (1, W)
    cos_t = np.cos(theta)[None, :]                          # (1, W)

    dx = sin_phi * sin_t                                    # (H, W)
    dy = np.broadcast_to(cos_phi, (H, W))                   # (H, W)
    dz = sin_phi * cos_t                                    # (H, W)

    t_best = np.full((H, W), np.inf, dtype=np.float64)
    label = np.zeros((H, W), dtype=np.int32)

    # --- floor plane (y = floor_y, dy < 0) ---
    with np.errstate(divide="ignore", invalid="ignore"):
        t_floor = floor_y / dy
    hx = t_floor * dx
    hz = t_floor * dz
    valid = (t_floor > 1e-6) & np.isfinite(t_floor) & _point_in_poly(hx, hz, poly)
    upd = valid & (t_floor < t_best)
    t_best = np.where(upd, t_floor, t_best)
    label = np.where(upd, 1, label)

    # --- ceiling plane (y = ceil_y, dy > 0) ---
    with np.errstate(divide="ignore", invalid="ignore"):
        t_ceil = ceil_y / dy
    hx = t_ceil * dx
    hz = t_ceil * dz
    valid = (t_ceil > 1e-6) & np.isfinite(t_ceil) & _point_in_poly(hx, hz, poly)
    upd = valid & (t_ceil < t_best)
    t_best = np.where(upd, t_ceil, t_best)
    label = np.where(upd, 2, label)

    # --- walls: vertical planes through polygon edges ---
    for i in range(N):
        P1 = poly[i]
        P2 = poly[(i + 1) % N]
        ex = P2[0] - P1[0]       # edge X
        ez = P2[1] - P1[1]       # edge Z
        # Ray.xz hits line P1->P2 when  t*dx - s*ex = P1.x ,  t*dz - s*ez = P1.z.
        # det = dx*(-ez) - (-ex)*dz = ex*dz - ez*dx
        det = ex * dz - ez * dx
        with np.errstate(divide="ignore", invalid="ignore"):
            safe = np.where(np.abs(det) < 1e-12, 1e-12, det)
            t_w = (ex * P1[1] - ez * P1[0]) / safe          # (H, W)
            s_w = (dx * P1[1] - dz * P1[0]) / safe          # (H, W)
        hit_y = t_w * dy
        valid = (
            (t_w > 1e-6)
            & np.isfinite(t_w)
            & (s_w > -1e-6) & (s_w < 1.0 + 1e-6)
            & (hit_y > floor_y - 1e-3) & (hit_y < ceil_y + 1e-3)
        )
        upd = valid & (t_w < t_best)
        t_best = np.where(upd, t_w, t_best)
        label = np.where(upd, 3 + i, label)

    masks = {
        "floor":   ((label == 1).astype(np.uint8) * 255),
        "ceiling": ((label == 2).astype(np.uint8) * 255),
    }
    for i in range(N):
        masks[f"wall_{i}"] = (label == 3 + i).astype(np.uint8) * 255
    return masks


def _apply_semantic_refinement(
    masks: Dict[str, np.ndarray],
    semantic_ids: np.ndarray,
) -> Dict[str, np.ndarray]:
    """Intersect each geometry mask with ADE20K's per-class mask so occluders
    (sofas, chairs, beds, curtains, windows, doors, AC units, plants,
    paintings, mirrors, railings, TVs, …) are carved out of the paintable
    region.

    Two-step logic per surface:

        1. ``keep``      =  HN geometry mask  ∧  (pixel is that ADE class)
                            — e.g. floor ∧ floor_class
        2. ``kill``      =  HN geometry mask  ∧  DILATED occluder silhouette
                            — catches SegFormer's ±few-pixel boundary
                            uncertainty, so no tile leaks onto the bed, chair
                            or sofa footprint.
        3. ``refined``   =  (keep ∨ HN∧wallish)  \\  kill

    ``wallish`` means we *also* keep pixels where the semantic class belongs
    to the same architectural family (wall/floor/ceiling) — this recovers
    floor patches the network was uncertain about (e.g. deep shadow) that
    would otherwise be dropped.

    Masks that shrink to <1 % of their original area fall back to the
    unrefined geometry mask.
    """
    from app.services import semantic_service as sem

    if semantic_ids.shape != masks["floor"].shape:
        import cv2
        h, w = masks["floor"].shape
        semantic_ids = cv2.resize(
            semantic_ids.astype(np.int32), (w, h), interpolation=cv2.INTER_NEAREST
        ).astype(np.uint16)

    sem_wall = sem.surface_class_mask(semantic_ids, "wall")
    sem_floor = sem.surface_class_mask(semantic_ids, "floor")
    sem_ceiling = sem.surface_class_mask(semantic_ids, "ceiling")
    occluder = sem.occluder_mask_from_ids(semantic_ids, dilate_px=6)

    out: Dict[str, np.ndarray] = {}
    for name, mask in masks.items():
        geom_bool = mask > 128

        if name == "floor":
            # Floor needs maximal continuity: keep the HorizonNet geometry
            # wherever semantic does not strongly claim wall/ceiling.
            # This avoids the common "missing floor wedges" artifact.
            allow = sem_floor | (~(sem_wall | sem_ceiling))
            other_arch = sem_wall | sem_ceiling
        elif name == "ceiling":
            allow = sem_ceiling
            other_arch = sem_wall | sem_floor
        elif name.startswith("wall_"):
            allow = sem_wall
            other_arch = sem_floor | sem_ceiling
        else:
            out[name] = mask
            continue

        # Positive: geometry AND (semantic says this IS the surface).
        # Fallback: geometry AND (NOT an occluder AND NOT another
        # architectural class) — recovers pixels the network mis-labelled as
        # "unknown material" but which are clearly within the HN plane.
        refined = geom_bool & (allow | (~occluder & ~other_arch))
        # Always kill any dilated-occluder pixel.
        refined &= ~occluder

        geom_area = int(geom_bool.sum())
        refined_area = int(refined.sum())
        if geom_area > 0 and refined_area < 0.01 * geom_area:
            out[name] = mask
        else:
            out[name] = (refined.astype(np.uint8) * 255)
    return out


# --- Top-level driver ----------------------------------------------------

def detect_and_render(
    panorama_path: str,
    out_dir: str,
    ckpt_path: str = DEFAULT_CKPT,
    camera_height_m: float = 1.6,
    out_size=(4096, 2048),
    force_cuboid: bool = True,
    align: bool = True,
    semantic_refine: bool = True,
) -> LayoutResult:
    import time as _time

    os.makedirs(out_dir, exist_ok=True)

    if align:
        t = _time.time()
        print("[layout] VP-aligning panorama (LSD)...", flush=True)
        src = np.array(Image.open(panorama_path).convert("RGB"))
        aligned = align_panorama(src)
        Image.fromarray(aligned).save(panorama_path, quality=92)
        print(f"[layout]   VP align: {_time.time()-t:.1f}s", flush=True)

    t = _time.time()
    print("[layout] HorizonNet inference...", flush=True)
    cor_id, z0, z1 = detect_corners(panorama_path, ckpt_path, force_cuboid)
    floor_polygon, room_height = cor_id_to_layout(cor_id, camera_height_m)
    width_m, depth_m, rotation = _bbox_metrics(floor_polygon)
    print(
        f"[layout]   HorizonNet: {_time.time()-t:.1f}s, "
        f"{len(floor_polygon)} corners, "
        f"{width_m:.1f}x{depth_m:.1f}x{room_height:.1f} m",
        flush=True,
    )

    t = _time.time()
    print(f"[layout] Rasterising masks {out_size}...", flush=True)
    masks = render_masks(floor_polygon, room_height, camera_height_m, out_size)
    print(f"[layout]   Masks: {_time.time()-t:.1f}s", flush=True)

    semantic_ids = None
    if semantic_refine:
        try:
            from app.services import semantic_service as sem
            t = _time.time()
            print("[layout] SegFormer ADE20K segmentation...", flush=True)
            pano_rgb = np.array(
                Image.open(panorama_path).convert("RGB").resize(out_size, Image.BICUBIC)
            )
            tiled = bool(int(os.environ.get("LAYOUT_TILED_SEMANTIC", "1")))
            semantic_ids = sem.segment_pano(pano_rgb, tiled=tiled)
            print(
                f"[layout]   Semantic: {_time.time()-t:.1f}s "
                f"(classes={int(np.unique(semantic_ids).size)})",
                flush=True,
            )
            sem.save_debug_overlay(
                pano_rgb, semantic_ids, os.path.join(out_dir, "debug_semantic.jpg")
            )
            masks = _apply_semantic_refinement(masks, semantic_ids)
        except Exception as exc:  # pragma: no cover — optional path
            print(f"[layout] semantic refinement skipped: {exc}", flush=True)

    for name, mask in masks.items():
        Image.fromarray(mask, mode="L").save(
            os.path.join(out_dir, f"mask_{name}.png"),
            optimize=True,
        )

    colors = [
        (200, 100, 50), (50, 100, 200),
        (50, 200, 50), (200, 200, 50),
        (200, 50, 200), (50, 200, 200),
        (255, 128, 0), (0, 255, 128),
    ]
    dbg = np.zeros((out_size[1], out_size[0], 3), dtype=np.uint8)
    for idx, (name, mask) in enumerate(masks.items()):
        c = colors[idx % len(colors)]
        dbg[mask > 128] = c
    Image.fromarray(dbg).save(os.path.join(out_dir, "debug_masks.jpg"), quality=85)

    result = LayoutResult(
        width_m=width_m,
        depth_m=depth_m,
        height_m=room_height,
        rotation_rad=rotation,
        floor_polygon_m=floor_polygon.tolist(),
        camera_height_m=camera_height_m,
        num_walls=len(floor_polygon),
    )

    with open(os.path.join(out_dir, "layout.json"), "w") as f:
        json.dump(
            {
                **asdict(result),
                "horizonnet": {"z0": z0, "z1": z1, "cor_id": cor_id.tolist()},
            },
            f,
            indent=2,
        )

    return result
