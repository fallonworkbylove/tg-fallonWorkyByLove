#!/usr/bin/env python3
"""EN profit cards: same layout as RU originals, TON + USD only (no rubles)."""
from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "images_folder_probe")
SRC_FALLBACK = os.path.join(HERE, "..", "images_folder")
OUT = os.path.join(HERE, "..", "images_folder_en")

# Exact panel starts from RU originals; keep same canvas size (no extend).
SPECS = [
    {
        "file": "profits1.png",
        "panel_y": 432,
        "title": "T1000 #32",
        "buy": ("450.9021", "689.14"),
        "sell": ("716.09", "1,094.45"),
        "diff": ("265.1879", "405.30"),
        "theme": "dark",
        "pad_x": 19,
        "title_dy": 8,
        "gap_title": 14,
        "gap_lines": 6,
        "gap_before_diff": 8,
        "fs_title": 14,
        "fs_body": 12,
    },
    {
        "file": "profits2.jpg",
        "panel_y": 608,
        "title": "BOXER #25",
        "buy": ("301.5967", "332.64"),
        "sell": ("578.22", "637.75"),
        "diff": ("276.6233", "305.10"),
        "theme": "light",
        "pad_x": 43,
        "title_dy": 25,
        "gap_title": 48,
        "gap_lines": 36,
        "gap_before_diff": 40,
        "fs_title": 26,
        "fs_body": 22,
    },
    {
        "file": "profits3.png",
        "panel_y": 432,
        "title": "Meebit #18494",
        "buy": ("232.6196", "355.53"),
        "sell": ("460.91", "704.44"),
        "diff": ("228.2904", "348.91"),
        "theme": "dark",
        "pad_x": 15,
        "title_dy": 8,
        "gap_title": 14,
        "gap_lines": 6,
        "gap_before_diff": 8,
        "fs_title": 14,
        "fs_body": 12,
    },
    {
        "file": "profits4.png",
        "panel_y": 432,
        "title": "alien fren #9671",
        "buy": ("872.98", "1,334.23"),
        "sell": ("1,043.24", "1,594.45"),
        "diff": ("170.26", "260.22"),
        "theme": "dark",
        "pad_x": 14,
        "title_dy": 8,
        "gap_title": 14,
        "gap_lines": 6,
        "gap_before_diff": 8,
        "fs_title": 14,
        "fs_body": 12,
    },
]


def find_font(bold: bool) -> str:
    names = (
        ["segoeuib.ttf", "arialbd.ttf", "calibrib.ttf", "DejaVuSans-Bold.ttf"]
        if bold
        else ["segoeui.ttf", "arial.ttf", "calibri.ttf", "DejaVuSans.ttf"]
    )
    for root in (
        r"C:\Windows\Fonts",
        "/usr/share/fonts/truetype/dejavu",
        "/usr/share/fonts/truetype/liberation",
    ):
        for name in names:
            path = os.path.join(root, name)
            if os.path.exists(path):
                return path
    raise FileNotFoundError("No usable font")


def sample_panel_bg(im: Image.Image, panel_y: int) -> tuple[int, int, int]:
    w, h = im.size
    samples = []
    for y in range(panel_y + 2, min(panel_y + 36, h - 2)):
        for x in (w // 2, w // 3, 2 * w // 3):
            samples.append(im.getpixel((x, y))[:3])
    samples.sort(key=lambda c: sum(c))
    return samples[len(samples) // 2]


def src_path(fname: str) -> str:
    p = os.path.join(SRC, fname)
    if os.path.exists(p):
        return p
    return os.path.join(SRC_FALLBACK, fname)


def render(spec: dict) -> str:
    base = Image.open(src_path(spec["file"])).convert("RGBA")
    w, h = base.size
    panel_y = spec["panel_y"]
    theme = spec["theme"]
    bg = sample_panel_bg(base, panel_y)
    im = base.copy()
    draw = ImageDraw.Draw(im)
    draw.rectangle((0, panel_y, w, h), fill=bg + (255,))

    font_title = ImageFont.truetype(find_font(True), spec["fs_title"])
    font_body = ImageFont.truetype(find_font(True), spec["fs_body"])
    font_quote = ImageFont.truetype(find_font(True), max(spec["fs_body"] + 2, 15))

    if theme == "dark":
        text_color = (255, 255, 255)
        accent = (144, 214, 230)
        quote_fill = (30, 45, 62)
    else:
        text_color = (20, 24, 30)
        accent = (100, 175, 200)
        quote_fill = (232, 244, 248)

    pad = spec["pad_x"]
    buy_t, buy_u = spec["buy"]
    sell_t, sell_u = spec["sell"]
    diff_t, diff_u = spec["diff"]

    y = panel_y + spec["title_dy"]
    draw.text((pad, y), spec["title"], fill=text_color + (255,), font=font_title)
    y = draw.textbbox((pad, y), spec["title"], font=font_title)[3] + spec["gap_title"]

    line1 = f"Purchase price: {buy_t} TON (${buy_u})"
    draw.text((pad, y), line1, fill=text_color + (255,), font=font_body)
    y = draw.textbbox((pad, y), line1, font=font_body)[3] + spec["gap_lines"]

    line2 = f"Sale price: {sell_t} TON (${sell_u})"
    draw.text((pad, y), line2, fill=text_color + (255,), font=font_body)
    y = draw.textbbox((pad, y), line2, font=font_body)[3] + spec["gap_before_diff"]

    diff = f"Difference: {diff_t} TON (${diff_u})"
    bb = draw.textbbox((0, 0), diff, font=font_body)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    pad_x, pad_y = 10, 5
    bar_w = 3
    box_x = pad - 2
    box_w = min(w - box_x - 8, tw + pad_x * 2 + bar_w + 18)
    box_h = th + pad_y * 2

    # Keep quote inside canvas; never move it up over previous lines.
    if y + box_h > h - 2:
        pad_y = max(2, h - 2 - y - th)
        box_h = th + pad_y * 2
    if y + box_h > h:
        box_h = max(th + 2, h - y)

    draw.rounded_rectangle(
        (box_x, y, box_x + box_w, min(y + box_h, h - 1)),
        radius=5,
        fill=quote_fill + (255,),
    )
    draw.rectangle(
        (box_x, y + 2, box_x + bar_w, min(y + box_h, h - 1) - 2),
        fill=accent + (255,),
    )
    draw.text(
        (box_x + bar_w + pad_x - 2, y + max(1, pad_y - 1)),
        diff,
        fill=text_color + (255,),
        font=font_body,
    )
    draw.text((box_x + box_w - 15, y), "”", fill=accent + (255,), font=font_quote)

    os.makedirs(OUT, exist_ok=True)
    out_name = "profits2.jpg" if spec["file"].endswith(".jpg") else spec["file"]
    out_path = os.path.join(OUT, out_name)
    if out_name.endswith(".jpg"):
        im.convert("RGB").save(out_path, quality=94, optimize=True)
    else:
        im.save(out_path, optimize=True)
    return out_path


def main() -> None:
    for spec in SPECS:
        print("wrote", render(spec))


if __name__ == "__main__":
    main()
