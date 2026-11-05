"""
Semantic segmentation service.

Runs SegFormer pretrained on ADE20K (150 indoor/outdoor classes) over the
panorama and returns a per-pixel class-id map at the panorama's resolution.

ADE20K gives us a direct notion of "paintable surface" vs "object":
    wall            → id 0
    floor           → id 3
    ceiling         → id 5
    window          → id 8
    door            → id 14
    painting        → id 22 (SegFormer ADE150 mapping)
    curtain         → id 18
    chair/sofa/bed  → ids 19, 23, 7
    ...

`layout_service` uses this map to carve occluders (sofas, balcony rails,
windows, doors, furniture, paintings, AC, plants, …) out of the HorizonNet
wall / floor / ceiling geometry masks so the frontend only tiles pixels
that truly belong to that surface.
"""

from __future__ import annotations

import os
from typing import Optional

import numpy as np
from PIL import Image

# ADE20K class ids we *keep* for each HorizonNet surface category.
#
# The ADE150 id2label table used by nvidia/segformer-b*-finetuned-ade-512-512
# puts the architectural surfaces at these ids (0-indexed).  Floor-like and
# ceiling-like variants are grouped together so runners, rugs, tile floors,
# carpets and wooden floors all still count as "floor".
ADE_WALL_IDS = {
    0,   # wall
}
ADE_FLOOR_IDS = {
    3,   # floor
    6,   # road (rare indoors, still floor-plane)
    9,   # grass (outdoor patios)
    11,  # sidewalk
    13,  # earth/ground
    28,  # rug
    52,  # path
}
ADE_CEILING_IDS = {
    5,   # ceiling
}

_MODEL_NAME = os.environ.get(
    "ADE20K_MODEL", "nvidia/segformer-b0-finetuned-ade-512-512"
)

_processor = None
_model = None
_torch = None


def _lazy_load():
    global _processor, _model, _torch
    if _model is None:
        import torch  # type: ignore
        from transformers import (  # type: ignore
            SegformerImageProcessor,
            SegformerForSemanticSegmentation,
        )

        _torch = torch
        _processor = SegformerImageProcessor.from_pretrained(_MODEL_NAME)
        _model = SegformerForSemanticSegmentation.from_pretrained(_MODEL_NAME).eval()
    return _processor, _model


def segment_pano(
    pano_rgb: np.ndarray,
    infer_size=(1024, 512),
    tiled: bool = True,
    n_tiles: int = 4,
    tile_res: int = 512,
    tile_overlap: float = 0.25,
) -> np.ndarray:
    """
    Run ADE20K segmentation on an equirectangular panorama.

    If ``tiled`` is True (default) the 360° panorama is sliced into ``n_tiles``
    horizontal crops with ``tile_overlap`` fraction of width shared between
    neighbours, each crop is inferred at ``tile_res`` × ``tile_res`` (the
    network's native training resolution), and the logits are stitched back
    using a cosine feather at overlap seams.  Because the pano wraps at the
    seam, the tile grid is shifted cyclically and a full wrap-around is
    handled.  This gives the network roughly 4× more pixels per object than
    a single whole-pano downsample, producing much sharper boundaries on
    beds, chairs, pillows, etc. which the geometry masks can rely on.

    If ``tiled`` is False, a single whole-pano pass at ``infer_size`` is used
    (faster, but jaggier boundaries — kept for quick smoke tests).

    Returns
    -------
    uint16 HxW array of class ids in [0, 149].
    """
    if tiled:
        return _segment_pano_tiled(
            pano_rgb, n_tiles=n_tiles, tile_res=tile_res, overlap=tile_overlap
        )
    return _segment_pano_whole(pano_rgb, infer_size=infer_size)


def _segment_pano_whole(
    pano_rgb: np.ndarray,
    infer_size=(1024, 512),
) -> np.ndarray:
    proc, model = _lazy_load()
    H, W = pano_rgb.shape[:2]
    small = Image.fromarray(pano_rgb).resize(infer_size, Image.BICUBIC)
    inputs = proc(images=small, return_tensors="pt")
    with _torch.no_grad():
        logits = model(**inputs).logits
    up = _torch.nn.functional.interpolate(
        logits, size=(H, W), mode="bilinear", align_corners=False
    )
    return up.argmax(dim=1)[0].cpu().numpy().astype(np.uint16)


def _segment_pano_tiled(
    pano_rgb: np.ndarray,
    n_tiles: int = 4,
    tile_res: int = 512,
    overlap: float = 0.25,
) -> np.ndarray:
    """Tiled inference with seam-feathered logit accumulation.

    Each tile is a (W//n_tiles)·(1+overlap) wide, full-height crop of the pano
    (wrapping cyclically at θ=0 ↔ θ=2π) resized to square ``tile_res``.
    Logits are accumulated into a global buffer weighted by a 1-D cosine
    window over the tile's horizontal axis, so boundaries between tiles
    dissolve smoothly and wrap at the seam.
    """
    proc, model = _lazy_load()
    H, W = pano_rgb.shape[:2]
    num_classes = model.config.num_labels

    # Tile layout.
    base_w = W // n_tiles
    tile_w = int(round(base_w * (1.0 + overlap)))
    # Cosine window for feathering along the tile's horizontal axis.
    x = np.arange(tile_w, dtype=np.float32)
    window_1d = 0.5 - 0.5 * np.cos(2.0 * np.pi * (x + 0.5) / tile_w)  # Hann
    window_1d = np.clip(window_1d, 1e-3, None)

    # Accumulators for class-logit sum and weight, in float16 to save RAM.
    logit_accum = np.zeros((num_classes, H, W), dtype=np.float32)
    weight_accum = np.zeros((H, W), dtype=np.float32)

    # Wrap-aware horizontal indices for each tile.
    # Start positions spaced every base_w, tiles extend base_w*(1+overlap)
    # wide, wrapping around.
    for i in range(n_tiles):
        start = (i * base_w - (tile_w - base_w) // 2) % W
        cols = (np.arange(tile_w) + start) % W  # indices into pano width

        crop = pano_rgb[:, cols, :]  # H × tile_w × 3
        # Resize to square tile_res for the network.
        pil = Image.fromarray(crop).resize((tile_res, tile_res), Image.BICUBIC)
        inputs = proc(images=pil, return_tensors="pt")
        with _torch.no_grad():
            logits = model(**inputs).logits  # 1 × C × h' × w'
        # Upsample back to (H, tile_w).
        up = _torch.nn.functional.interpolate(
            logits, size=(H, tile_w), mode="bilinear", align_corners=False
        )[0].cpu().numpy()  # C × H × tile_w

        # Feather weighting.
        w2d = window_1d[None, None, :]  # 1×1×tile_w, broadcasts over C,H
        up *= w2d
        # Scatter into global accumulators at `cols`.
        # Group writes by index – fancy-indexing handles wrap-around correctly.
        logit_accum[:, :, cols] += up.astype(np.float32)
        weight_accum[:, cols] += window_1d[None, :]

    # Normalise and argmax.
    weight_accum = np.maximum(weight_accum, 1e-6)
    logit_accum /= weight_accum[None, :, :]
    ids = np.argmax(logit_accum, axis=0).astype(np.uint16)
    return ids


# Classes that should "block" a surface from being painted even if the
# surface's geometry mask covers them (sofas, chairs, tables, beds, paintings,
# TVs, lamps, plants, books, clothing, mirrors, railings, etc.).  Everything
# not in wall/floor/ceiling lists is effectively an occluder, but we keep an
# explicit "furniture" set for dilating the occluder silhouette a few pixels
# so mask boundaries stay clear of object edges.
ADE_FURNITURE_IDS = {
    7,   # bed
    10,  # cabinet
    15,  # table
    19,  # chair
    23,  # sofa
    24,  # shelf
    30,  # armchair
    31,  # seat
    33,  # desk
    34,  # rock (unlikely indoor)
    35,  # wardrobe
    36,  # lamp
    39,  # cushion
    41,  # box
    44,  # chest of drawers
    45,  # counter
    47,  # sink
    50,  # refrigerator
    56,  # pool table
    57,  # pillow
    62,  # bench
    63,  # book
    64,  # hill
    65,  # coffee table
    66,  # toilet
    67,  # flower
    69,  # book (again in some taxonomies)
    70,  # bench
    71,  # countertop
    74,  # kitchen island
    75,  # computer
    78,  # stove
    82,  # light
    83,  # truck
    89,  # television
    97,  # ottoman
    99,  # bottle
    108, # stool
    110, # towel
    112, # washer
    115, # plaything
    117, # bar
    119, # cradle
    120, # oven
    124, # microwave
    125, # pot
    129, # screen
    130, # stairway
    131, # stairs
    133, # hood
    134, # sconce
    135, # vase
    138, # tray
    139, # ashcan
    142, # plate
    143, # monitor
    147, # fan
    148, # pier
}


def occluder_mask_from_ids(
    semantic_ids: np.ndarray,
    dilate_px: int = 6,
) -> np.ndarray:
    """Return a bool mask of "definitely not paintable" pixels.

    Everything that is NOT wall/floor/ceiling is considered an occluder.  The
    mask is dilated by ``dilate_px`` pixels (default 6) so the boundary lies
    safely outside the furniture silhouette — this hides SegFormer's ±few-pixel
    boundary uncertainty without visibly shrinking the object.
    """
    import cv2
    wfc = (
        np.isin(semantic_ids, list(ADE_WALL_IDS))
        | np.isin(semantic_ids, list(ADE_FLOOR_IDS))
        | np.isin(semantic_ids, list(ADE_CEILING_IDS))
    )
    occ = (~wfc).astype(np.uint8)
    if dilate_px > 0:
        k = 2 * dilate_px + 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
        occ = cv2.dilate(occ, kernel, iterations=1)
    return occ.astype(bool)


def surface_class_mask(
    semantic_ids: np.ndarray,
    surface_kind: str,
) -> np.ndarray:
    """Return a bool mask of pixels whose semantic class matches `surface_kind`.

    surface_kind is one of {"wall", "floor", "ceiling"}.
    """
    if surface_kind == "wall":
        keep = ADE_WALL_IDS
    elif surface_kind == "floor":
        keep = ADE_FLOOR_IDS
    elif surface_kind == "ceiling":
        keep = ADE_CEILING_IDS
    else:
        raise ValueError(f"unknown surface kind: {surface_kind}")

    mask = np.zeros(semantic_ids.shape, dtype=bool)
    for cid in keep:
        mask |= semantic_ids == cid
    return mask


def id2label() -> dict:
    """Return ADE150 id->label mapping (for debugging / visualisation)."""
    proc, model = _lazy_load()
    return dict(model.config.id2label)


def save_debug_overlay(
    pano_rgb: np.ndarray,
    semantic_ids: np.ndarray,
    out_path: str,
    alpha: float = 0.55,
) -> None:
    """Write a colour-coded overlay of the semantic map for inspection."""
    rng = np.random.default_rng(0)
    palette = rng.integers(0, 255, size=(256, 3), dtype=np.uint8)
    # Fix a few important ones to recognisable colours.
    palette[0] = (180, 140, 110)   # wall
    palette[3] = (230, 160, 60)    # floor
    palette[5] = (90, 130, 220)    # ceiling
    palette[8] = (80, 220, 220)    # window
    palette[14] = (200, 50, 200)   # door

    ids = semantic_ids.copy()
    ids[ids >= 256] = 0
    overlay = palette[ids.astype(np.uint8)]
    blend = (pano_rgb.astype(np.float32) * (1 - alpha) +
             overlay.astype(np.float32) * alpha).clip(0, 255).astype(np.uint8)
    Image.fromarray(blend).save(out_path, quality=85)
