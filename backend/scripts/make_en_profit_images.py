#!/usr/bin/env python3
"""EN cards: clean panel inside RU message bounds (keep wallpaper margins)."""
from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "images_folder_probe")
SRC_FALLBACK = os.path.join(HERE, "..", "images_folder")
OUT = os.path.join(HERE, "..", "images_folder_en")


def find_font(size: int) -> ImageFont.FreeTypeFont:
    for name in ("segoeuib.ttf", "arialbd.ttf", "calibrib.ttf"):
        path = os.path.join(r"C:\Windows\Fonts", name)
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)


def src_path(fname: str) -> str:
    p = os.path.join(SRC, fname)
    return p if os.path.exists(p) else os.path.join(SRC_FALLBACK, fname)


def find_white_card_x(im: Image.Image, panel_y: int) -> tuple[int, int]:
    """Left/right of white message card inside screenshot (wallpaper margins stay)."""
    w, h = im.size
    y = min(panel_y + 80, h - 10)
    left = 0
    right = w - 1
    for x in range(w):
        r, g, b = im.getpixel((x, y))
        if r > 240 and g > 240 and b > 240:
            left = x
            break
    for x in range(w - 1, -1, -1):
        r, g, b = im.getpixel((x, y))
        if r > 240 and g > 240 and b > 240:
            right = x
            break
    return left, right


def render_boxer() -> str:
    fname = "profits2.jpg"
    ru = Image.open(src_path(fname)).convert("RGB")
    im = ru.copy()
    w, h = im.size
    panel_y = 608
    left, right = find_white_card_x(ru, panel_y)
    # keep a couple px inside for AA
    left = max(0, left)
    right = min(w - 1, right)

    # Preserve wallpaper margins from RU, only wipe the white card body
    margins_left = ru.crop((0, panel_y, left, h))
    margins_right = ru.crop((right + 1, panel_y, w, h))

    draw = ImageDraw.Draw(im)
    draw.rectangle((left, panel_y, right, h - 1), fill=(255, 255, 255))

    # Quote chrome from RU, clipped to card
    qy0, qy1 = 888, 940
    qx0, qx1 = max(left + 4, 40), min(right - 4, 600)
    quote = ru.crop((qx0, qy0, qx1, qy1)).copy()
    qd = ImageDraw.Draw(quote)
    qw, qh = quote.size
    # wipe text, keep left bar (~4px) and right ” (~24px)
    qd.rectangle((10, 4, max(11, qw - 26), qh - 4), fill=(236, 246, 250))
    im.paste(quote, (qx0, qy0))

    # restore wallpaper margins so white never sticks past the photo/message edge
    im.paste(margins_left, (0, panel_y))
    im.paste(margins_right, (right + 1, panel_y))

    ink = (18, 22, 28)
    font_title = find_font(26)
    font_body = find_font(22)
    pad = left + 22

    draw = ImageDraw.Draw(im)
    draw.text((pad, 633), "BOXER #25", fill=ink, font=font_title)
    draw.text((pad, 719), "Purchase price: 301.5967 TON", fill=ink, font=font_body)
    draw.text((pad, 761), "($332.64)", fill=ink, font=font_body)
    draw.text((pad, 804), "Sale price: 578.22 TON", fill=ink, font=font_body)
    draw.text((pad, 847), "($637.75)", fill=ink, font=font_body)
    draw.text((pad + 16, 904), "Difference: 276.6233 TON ($305.10)", fill=ink, font=font_body)

    out = os.path.join(OUT, fname)
    os.makedirs(OUT, exist_ok=True)
    im.save(out, quality=95, optimize=True)
    print(f"boxer card x={left}..{right} (kept wallpaper margins)")
    return out


def render_dark(fname: str, title: str, buy: str, sell: str, diff: str, pad: int) -> str:
    ru = Image.open(src_path(fname)).convert("RGBA")
    w, h = ru.size
    panel_y = 432
    samples = [
        ru.getpixel((x, y))[:3]
        for y in range(panel_y + 4, panel_y + 24)
        for x in (w // 2, w // 3)
    ]
    samples.sort(key=lambda c: sum(c))
    bg = samples[len(samples) // 2]

    im = ru.copy()
    draw = ImageDraw.Draw(im)
    draw.rectangle((0, panel_y, w, h), fill=bg + (255,))

    qy0, qy1 = 508, min(h - 2, 536)
    quote = ru.crop((pad - 4, qy0, min(w - 8, pad + 310), qy1)).copy()
    qd = ImageDraw.Draw(quote)
    qw, qh = quote.size
    qd.rectangle((8, 2, max(9, qw - 22), qh - 2), fill=(30, 45, 62, 255))
    im.paste(quote, (pad - 4, qy0), quote if quote.mode == "RGBA" else None)

    font_title = find_font(15)
    font_body = find_font(13)
    ink = (255, 255, 255, 255)
    draw = ImageDraw.Draw(im)
    draw.text((pad, 441), title, fill=ink, font=font_title)
    draw.text((pad, 477), buy, fill=ink, font=font_body)
    draw.text((pad, 495), sell, fill=ink, font=font_body)
    draw.text((pad + 10, 514), diff, fill=ink, font=font_body)

    out = os.path.join(OUT, fname)
    os.makedirs(OUT, exist_ok=True)
    im.save(out, optimize=True)
    return out


def main() -> None:
    print("wrote", render_boxer())
    print(
        "wrote",
        render_dark(
            "profits1.png",
            "T1000 #32",
            "Purchase price: 450.9021 TON ($689.14)",
            "Sale price: 716.09 TON ($1,094.45)",
            "Difference: 265.1879 TON ($405.30)",
            19,
        ),
    )
    print(
        "wrote",
        render_dark(
            "profits3.png",
            "Meebit #18494",
            "Purchase price: 232.6196 TON ($355.53)",
            "Sale price: 460.91 TON ($704.44)",
            "Difference: 228.2904 TON ($348.91)",
            15,
        ),
    )
    print(
        "wrote",
        render_dark(
            "profits4.png",
            "alien fren #9671",
            "Purchase price: 872.98 TON ($1,334.23)",
            "Sale price: 1043.24 TON ($1,594.45)",
            "Difference: 170.26 TON ($260.22)",
            14,
        ),
    )


if __name__ == "__main__":
    main()
