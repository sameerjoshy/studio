#!/usr/bin/env python3
"""Key the magenta pose renders into transparent PNGs for the Hero Kit.

- patches the Gemini sparkle in the bottom-right corner
- chroma-keys the flat magenta background with a soft edge
- mild magenta despill on the semi-transparent fringe
- crops to the character with padding

Usage:
  python scripts/key_poses.py --src "D:/GTM-Engine/Poses" --out runner/templates/hero-kit/poses
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

# Canonical pose name -> source filename
POSES = {
    "stance": "Stance .png",
    "fly": "fly1.png",
    "land": "land.png",
    "point": "point.png",
    "thumbsup": "Thumbsup.png",
    "crossed": "crossed arms.png",
    "thinking": "thinking.png",
    "shrug": "shrug.png",
    "celebrate": "celebrate.png",
    "wave": "wave.png",
    "present": "Presenting.png",
}


def background_color(arr: np.ndarray) -> np.ndarray:
    h, w, _ = arr.shape
    blocks = [
        arr[0:12, 0:12],
        arr[0:12, w - 12 : w],
        arr[h - 12 : h, 0:12],
        arr[h - 12 : h, w - 12 : w],
        arr[0:12, w // 2 - 6 : w // 2 + 6],
        arr[h - 12 : h, w // 2 - 6 : w // 2 + 6],
    ]
    samples = np.concatenate([block.reshape(-1, 3) for block in blocks], axis=0)
    return np.median(samples, axis=0)


def key_image(src: Path, dst: Path) -> None:
    image = Image.open(src).convert("RGB")
    arr = np.array(image).astype(np.float32)
    h, w, _ = arr.shape

    bg = background_color(arr)

    # Patch the Gemini sparkle (bottom-right) with the local background colour.
    # The sparkle sits just above the corner, so cover a tall corner block.
    patch_w, patch_h = 180, 230
    x0, y0 = w - patch_w, h - patch_h
    arr[max(0, y0) : h, max(0, x0) : w] = bg

    # Soft chroma key by colour distance to the background.
    distance = np.sqrt(((arr - bg) ** 2).sum(axis=2))
    alpha = np.clip((distance - 42.0) / (92.0 - 42.0), 0.0, 1.0)

    # Aggressive magenta despill: the render has a pink rim light baked into the
    # character edge, so pull R and B toward G wherever magenta dominates.
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    magenta_score = (r + b) / 2.0 - g
    mask = magenta_score > 50
    reduce = np.clip((magenta_score - 50.0) / 80.0, 0.0, 1.0) * 0.9
    arr[..., 0] = np.where(mask, r - reduce * (r - g), r)
    arr[..., 2] = np.where(mask, b - reduce * (b - g), b)

    # Shrink the matte by one pixel to drop the outermost fringe.
    alpha_image = Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(
        ImageFilter.MinFilter(3)
    )
    alpha = np.array(alpha_image).astype(np.float32) / 255.0

    rgba = np.dstack([arr.astype(np.uint8), (alpha * 255).astype(np.uint8)])
    keyed = Image.fromarray(rgba, "RGBA")

    bbox = keyed.getbbox()
    if bbox:
        pad = 24
        left, top, right, bottom = bbox
        keyed = keyed.crop(
            (
                max(0, left - pad),
                max(0, top - pad),
                min(w, right + pad),
                min(h, bottom + pad),
            )
        )

    dst.parent.mkdir(parents=True, exist_ok=True)
    keyed.save(dst)
    print(f"{src.name:22} -> {dst.name:22} {keyed.size[0]}x{keyed.size[1]} bg={bg.astype(int).tolist()}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    src_dir = Path(args.src)
    out_dir = Path(args.out)
    missing = []

    for pose, filename in POSES.items():
        source = src_dir / filename
        if not source.exists():
            missing.append(filename)
            continue
        key_image(source, out_dir / f"pose-{pose}.png")

    if missing:
        print("MISSING:", ", ".join(missing))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
