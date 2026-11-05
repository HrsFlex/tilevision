from __future__ import annotations

import logging
import numpy as np

logger = logging.getLogger(__name__)

try:
    import torch
    _HAS_TORCH = True
except ImportError:
    _HAS_TORCH = False


class SAMService:
    """Wraps SAM 2.1 model for single-image mask prediction."""

    def __init__(self):
        self._predictor = None
        if _HAS_TORCH:
            self._device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            self._device = "cpu"

    def is_loaded(self) -> bool:
        return self._predictor is not None

    def load_model(self):
        if self._predictor is not None:
            return
        if not _HAS_TORCH:
            logger.warning(
                "torch not installed — running in mock mode. "
                "Install torch + sam2 for real segmentation."
            )
            return
        try:
            from sam2.sam2_image_predictor import SAM2ImagePredictor

            logger.info("Loading SAM 2.1 model on %s ...", self._device)
            self._predictor = SAM2ImagePredictor.from_pretrained(
                "facebook/sam2.1-hiera-tiny", device=self._device
            )
            logger.info("SAM 2.1 loaded successfully.")
        except Exception:
            logger.warning(
                "SAM 2.1 not available — running in mock mode. "
                "Install sam2 and download checkpoints for real segmentation."
            )
            self._predictor = None

    def predict(
        self,
        image: np.ndarray,
        points: list[list[float]],
        labels: list[int],
    ) -> tuple[np.ndarray, float, list[int]]:
        """
        Run SAM prediction.

        Args:
            image: HWC uint8 numpy array (RGB)
            points: [[x, y], ...] click coordinates
            labels: [1, 0, ...] — 1=foreground, 0=background

        Returns:
            (mask, score, bbox) where mask is HW bool array,
            score is float confidence, bbox is [x1, y1, x2, y2]
        """
        if self._predictor is None:
            return self._mock_predict(image, points, labels)

        with torch.inference_mode():
            self._predictor.set_image(image)
            masks, scores, _ = self._predictor.predict(
                point_coords=np.array(points, dtype=np.float32),
                point_labels=np.array(labels, dtype=np.int32),
            )

        # Pick the highest scoring mask
        best_idx = int(np.argmax(scores))
        mask = masks[best_idx]  # (H, W) bool
        score = float(scores[best_idx])

        # Compute bounding box
        ys, xs = np.where(mask)
        if len(xs) == 0:
            bbox = [0, 0, 0, 0]
        else:
            bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]

        return mask, score, bbox

    def _mock_predict(
        self,
        image: np.ndarray,
        points: list[list[float]],
        labels: list[int],
    ) -> tuple[np.ndarray, float, list[int]]:
        """Generate a rectangular mock mask around the clicked point for dev/demo."""
        h, w = image.shape[:2]
        mask = np.zeros((h, w), dtype=bool)

        # Create a region around the click point
        cx, cy = int(points[0][0]), int(points[0][1])
        region_w, region_h = w // 3, h // 3
        x1 = max(0, cx - region_w // 2)
        y1 = max(0, cy - region_h // 2)
        x2 = min(w, cx + region_w // 2)
        y2 = min(h, cy + region_h // 2)
        mask[y1:y2, x1:x2] = True

        return mask, 0.85, [x1, y1, x2, y2]


# Singleton
sam_service = SAMService()
