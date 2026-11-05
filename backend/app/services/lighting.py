from __future__ import annotations

import cv2
import numpy as np


def extract_lightmap(
    image: np.ndarray, mask: np.ndarray, blur_sigma: int = 15
) -> np.ndarray:
    """
    Extract a lighting/shadow map from the original image within the mask region.

    1. Convert masked region to grayscale
    2. Apply Gaussian blur to remove texture detail but keep shadows
    3. Normalize so median brightness = 128

    Returns an HW uint8 grayscale image (full frame, 128 outside mask).
    """
    h, w = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY).astype(np.float32)

    # Blur to remove texture pattern, keep only lighting variation
    ksize = blur_sigma * 4 + 1  # kernel must be odd
    blurred = cv2.GaussianBlur(gray, (ksize, ksize), blur_sigma)

    # Normalize: median of masked region → 128
    masked_values = blurred[mask]
    if len(masked_values) == 0:
        return np.full((h, w), 128, dtype=np.uint8)

    median_val = np.median(masked_values)
    if median_val < 1.0:
        median_val = 1.0

    lightmap = (blurred / median_val) * 128.0
    lightmap = np.clip(lightmap, 0, 255).astype(np.uint8)

    # Set outside mask to neutral (128 = no effect when used as multiply)
    result = np.full((h, w), 128, dtype=np.uint8)
    result[mask] = lightmap[mask]

    return result
