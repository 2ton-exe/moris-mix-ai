# SPDX-License-Identifier: CC0-1.0
"""Create original material textures without reading any image or network source.

Run from any directory with Python 3 and Pillow installed. Outputs replace only
this checkout's two journal JPEGs. No application dependency is added.
"""
from math import sin
from pathlib import Path
from random import Random

from PIL import Image, ImageChops, ImageFilter, ImageOps

OUTPUT = Path(__file__).resolve().parents[3] / "frontend/src/assets/journal/textures"


def noise(size, seed):
    rng = Random(seed)
    return Image.frombytes("L", size, rng.randbytes(size[0] * size[1]))


def wood():
    size = (2000, 1474)
    pixels = bytearray()
    rng = Random(2701)
    for y in range(size[1]):
        board = y // 369
        for x in range(size[0]):
            flow = y + 16 * sin(x / 350 + board) + 5 * sin(x / 110 + y / 250)
            grain = 4 * sin(flow * 1.8) + 3 * sin(flow * .43)
            tone = 6 * sin(flow / 47) + 3 * sin(x / 470) + grain + rng.uniform(-3, 3)
            seam = -18 if y % 369 < 2 else 0
            pixels.extend(max(0, min(255, round(c + tone + seam))) for c in (184, 145, 97))
    return Image.frombytes("RGB", size, bytes(pixels))


def leather():
    size = (1000, 825)
    fine = noise(size, 2702)
    pebbles = noise((200, 165), 2703).resize(size, Image.Resampling.BICUBIC)
    pebbles = pebbles.filter(ImageFilter.GaussianBlur(.7))
    relief = ImageChops.subtract(pebbles, pebbles.filter(ImageFilter.GaussianBlur(2)), 1, 128)
    grain = Image.blend(relief, fine, .14)
    grain = ImageOps.autocontrast(grain).point(lambda value: 104 + value * .17)
    return grain.convert("RGB")


if __name__ == "__main__":
    for name, create, size in (
        ("desk-oak.jpg", wood, (2000, 1474)),
        ("leather-relief.jpg", leather, (1000, 825)),
    ):
        result = create()
        assert result.mode == "RGB" and result.size == size
        assert all(high > low for low, high in result.getextrema())
        path = OUTPUT / name
        result.save(path, "JPEG", quality=88, optimize=True, subsampling=0)
        with Image.open(path) as saved:
            assert saved.size == size and saved.format == "JPEG"
        print(f"Created {path.relative_to(OUTPUT.parent)} ({size[0]} × {size[1]})")
