"""Erzeugt die App-Icons (Tannenbaum auf Grün) in web/icons/.

    conda activate weihnachten
    python tools/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

GREEN = (30, 58, 43)
TREE = (76, 154, 96)
TREE_DARK = (47, 110, 66)
GOLD = (255, 214, 102)
RED = (179, 38, 30)
TRUNK = (110, 70, 40)

OUT = Path(__file__).resolve().parent.parent / "web" / "icons"


def draw_icon(size: int, padding: float) -> Image.Image:
    """padding = Anteil Rand (maskable Icons brauchen mehr Rand)."""
    scale = 4  # weich zeichnen und dann verkleinern
    s = size * scale
    img = Image.new("RGB", (s, s), GREEN)
    d = ImageDraw.Draw(img)
    inner = s * (1 - 2 * padding)
    x0 = s * padding
    y0 = s * padding
    cx = s / 2

    def tier(top, bottom, half_width, color):
        d.polygon([(cx, y0 + inner * top), (cx - inner * half_width, y0 + inner * bottom),
                   (cx + inner * half_width, y0 + inner * bottom)], fill=color)

    # Stamm
    d.rectangle([cx - inner * 0.06, y0 + inner * 0.80, cx + inner * 0.06, y0 + inner * 0.95], fill=TRUNK)
    # Drei Ebenen
    tier(0.40, 0.84, 0.40, TREE_DARK)
    tier(0.24, 0.64, 0.31, TREE)
    tier(0.10, 0.44, 0.22, TREE_DARK)
    # Kugeln
    r = inner * 0.035
    for bx, by, color in [(-0.16, 0.74, RED), (0.18, 0.70, GOLD), (0.06, 0.55, RED), (-0.10, 0.50, GOLD), (0.04, 0.34, RED)]:
        px, py = cx + inner * bx, y0 + inner * by
        d.ellipse([px - r, py - r, px + r, py + r], fill=color)
    # Stern
    sr = inner * 0.07
    sy = y0 + inner * 0.08
    import math
    points = []
    for i in range(10):
        angle = -math.pi / 2 + i * math.pi / 5
        radius = sr if i % 2 == 0 else sr * 0.45
        points.append((cx + radius * math.cos(angle), sy + radius * math.sin(angle)))
    d.polygon(points, fill=GOLD)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    draw_icon(192, 0.10).save(OUT / "icon-192.png")
    draw_icon(512, 0.10).save(OUT / "icon-512.png")
    draw_icon(512, 0.20).save(OUT / "icon-maskable-512.png")
    draw_icon(180, 0.10).save(OUT / "apple-touch-icon.png")
    print("Icons geschrieben nach", OUT)


if __name__ == "__main__":
    main()
