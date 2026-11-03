#!/usr/bin/env python3
"""Generate GTM Hero YouTube thumbnails (1280x720) from the keyed poses."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

INK = (5, 11, 20)
INK2 = (10, 23, 38)
MINT = (52, 211, 153)
GOLD = (233, 180, 76)
WHITE = (248, 250, 252)
MUTED = (148, 163, 184)

FONT_BOLD = "C:/Windows/Fonts/arialbd.ttf"
FONT_REG = "C:/Windows/Fonts/arial.ttf"


def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


def background() -> Image.Image:
    image = Image.new("RGB", (1280, 720), INK)
    draw = ImageDraw.Draw(image)
    for y in range(720):
        t = y / 719
        color = tuple(int(INK[i] + (INK2[i] - INK[i]) * t) for i in range(3))
        draw.line([(0, y), (1280, y)], fill=color)

    glow = Image.new("RGBA", (1280, 720), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse([640, 40, 1420, 820], fill=(*MINT, 46))
    gdraw.ellipse([-260, 380, 420, 980], fill=(79, 70, 229, 54))
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    image = Image.alpha_composite(image.convert("RGBA"), glow)

    grid = Image.new("RGBA", (1280, 720), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for x in range(0, 1280, 64):
        gd.line([(x, 0), (x, 720)], fill=(255, 255, 255, 8))
    for y in range(0, 720, 64):
        gd.line([(0, y), (1280, y)], fill=(255, 255, 255, 8))
    image = Image.alpha_composite(image, grid)

    vignette = Image.new("RGBA", (1280, 720), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vignette)
    vd.ellipse([-320, -220, 1600, 940], fill=(0, 0, 0, 0))
    vignette = vignette.filter(ImageFilter.GaussianBlur(140))
    return image


def bowtie(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, color=MINT):
    draw.polygon([(x, y), (x + w * 0.42, y + h / 2), (x, y + h)], fill=color)
    draw.polygon([(x + w, y), (x + w * 0.58, y + h / 2), (x + w, y + h)], fill=WHITE)


def wrap(draw: ImageDraw.ImageDraw, text: str, fnt, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=fnt) > max_width and current:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def load_pose(path: Path, height: int) -> Image.Image:
    pose = Image.open(path).convert("RGBA")
    ratio = height / pose.height
    return pose.resize((int(pose.width * ratio), height), Image.LANCZOS)


def variant_a(pose: Image.Image, title: str, episode: str) -> Image.Image:
    image = background()
    hero = load_pose(pose, 690)
    image.alpha_composite(hero, (1280 - hero.width + 30, 720 - hero.height))

    draw = ImageDraw.Draw(image)
    draw.rectangle([64, 96, 68, 128], fill=MINT)
    draw.text((92, 96), "GUARDIAN OF GTM", font=font(24), fill=MINT)

    fnt = font(74)
    lines = wrap(draw, title.upper(), fnt, 700)
    y = 300
    for line in lines:
        draw.text((64, y), line, font=fnt, fill=WHITE)
        y += 84

    draw.text((66, 620), f"EPISODE {episode}", font=font(26, False), fill=MUTED)
    bowtie(draw, 64, 660, 56, 34)
    return image.convert("RGB")


def variant_b(pose: Image.Image, title: str, episode: str) -> Image.Image:
    image = background()
    hero = load_pose(pose, 545)
    image.alpha_composite(hero, ((1280 - hero.width) // 2, 720 - hero.height + 10))

    draw = ImageDraw.Draw(image)
    draw.text((64, 26), "GUARDIAN OF GTM", font=font(24), fill=MINT)

    fnt = font(64)
    lines = wrap(draw, title.upper(), fnt, 1150)
    y = 64
    for line in lines:
        width = draw.textlength(line, font=fnt)
        draw.text(((1280 - width) / 2, y), line, font=fnt, fill=WHITE)
        y += 72

    label = f"EPISODE {episode}"
    width = draw.textlength(label, font=font(26, False))
    draw.rounded_rectangle(
        [(640 - width / 2 - 18, 600), (640 + width / 2 + 18, 648)],
        radius=24,
        fill=(5, 11, 20, 180),
        outline=MINT,
        width=2,
    )
    draw.text((640 - width / 2, 610), label, font=font(26, False), fill=WHITE)
    return image.convert("RGB")


def variant_c(pose: Image.Image, title: str, episode: str) -> Image.Image:
    image = background()
    bust = load_pose(pose, 900)
    crop = bust.crop((0, 0, bust.width, min(bust.height, 720)))
    image.alpha_composite(crop, (1280 - crop.width - 20, 0))

    draw = ImageDraw.Draw(image)
    draw.text((64, 90), f"EP {episode}", font=font(120), fill=GOLD)
    draw.text((64, 230), "GUARDIAN OF GTM", font=font(26), fill=MINT)

    fnt = font(58)
    lines = wrap(draw, title.upper(), fnt, 520)
    y = 290
    for line in lines:
        draw.text((64, y), line, font=fnt, fill=WHITE)
        y += 66

    bowtie(draw, 64, 640, 64, 38)
    return image.convert("RGB")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--poses", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--title", default="Pipeline Hygiene")
    parser.add_argument("--episode", default="01")
    args = parser.parse_args()

    poses = Path(args.poses)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    stance = poses / "pose-stance.png"
    point = poses / "pose-point.png"
    celebrate = poses / "pose-celebrate.png"

    variant_a(stance, args.title, args.episode).save(out / "thumb-a.png")
    variant_b(point, args.title, args.episode).save(out / "thumb-b.png")
    variant_c(celebrate, args.title, args.episode).save(out / "thumb-c.png")
    print(f"wrote {out / 'thumb-a.png'}")
    print(f"wrote {out / 'thumb-b.png'}")
    print(f"wrote {out / 'thumb-c.png'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
