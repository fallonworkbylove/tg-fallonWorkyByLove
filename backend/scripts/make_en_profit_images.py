#!/usr/bin/env python3
"""Rebuild English profit screenshots from RU assets (labels + USD)."""
from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFont

SRC = os.path.join(os.path.dirname(__file__), "..", "images_folder_probe")
OUT = os.path.join(os.path.dirname(__file__), "..", "images_folder_en")

# title, buy_ton, buy_usd, sell_ton, sell_usd, diff_ton, diff_usd,
# panel_y_frac, bg, text, accent, title_color
SPECS = [
    (
        "profits1.png",
        "T1000 #32",
        "450.9021",
        "689.14",
        "716.09",
        "1,094.45",
        "265.1879",
        "405.30",
        0.70,
        (24, 37, 51),
        (255, 255, 255),
        (120, 200, 230),
        (255, 255, 255),
    ),
    (
        "profits2.jpg",
        "BOXER #25",
        "301.5967",
        "332.64",
        "578.22",
        "637.75",
        "276.6233",
        "305.10",
        0.66,
        (255, 255, 255),
        (20, 25, 35),
        (70, 160, 210),
        (20, 25, 35),
    ),
    (
        "profits3.png",
        "Meebit #18494",
        "232.6196",
        "355.53",
        "460.91",
        "704.44",
        "228.2904",
        "348.91",
        0.70,
        (24, 37, 51),
        (255, 255, 255),
        (120, 200, 230),
        (255, 255, 255),
    ),
    (
        "profits4.png",
        "alien fren #9671",
        "872.98",
        "1,334.23",
        "1,043.24",
        "1,594.45",
        "170.26",
        "260.22",
        0.70,
        (24, 37, 51),
        (255, 255, 255),
        (120, 200, 230),
        (255, 255, 255),
    ),
]


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    font_candidates = [
        r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    font_path = next(p for p in font_candidates if os.path.exists(p))

    for (
        fname,
        title,
        bt,
        bu,
        st,
        su,
        dt,
        du,
        yfrac,
        bg,
        tc,
        ac,
        title_c,
    ) in SPECS:
        im = Image.open(os.path.join(SRC, fname)).convert("RGBA")
        w, h = im.size
        y0 = int(h * yfrac)
        draw = ImageDraw.Draw(im)
        draw.rectangle([0, y0, w, h], fill=bg + (255,))

        fs_title = max(18, int(w * 0.055))
        fs_body = max(14, int(w * 0.042))
        font_title = ImageFont.truetype(font_path, fs_title)
        font_body = ImageFont.truetype(font_path, fs_body)

        pad_x = int(w * 0.06)
        line_h = int(fs_body * 1.55)
        y = y0 + int(h * 0.03)

        draw.text((pad_x, y), title, fill=title_c + (255,), font=font_title)
        y += int(fs_title * 1.45)

        for line in (
            f"Purchase price: {bt} TON (${bu})",
            f"Sale price: {st} TON (${su})",
        ):
            draw.text((pad_x, y), line, fill=tc + (255,), font=font_body)
            y += line_h

        diff = f"Difference: {dt} TON (${du})"
        bar_w = max(3, int(w * 0.012))
        block_pad = int(fs_body * 0.35)
        bbox = draw.textbbox((0, 0), diff, font=font_body)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        strip = (245, 250, 255, 255) if bg[0] > 200 else (30, 48, 68, 255)
        draw.rectangle(
            [pad_x - 4, y - block_pad, pad_x + tw + int(w * 0.08), y + th + block_pad],
            fill=strip,
        )
        draw.rectangle(
            [pad_x - 4, y - block_pad, pad_x - 4 + bar_w, y + th + block_pad],
            fill=ac + (255,),
        )
        draw.text((pad_x + bar_w + 6, y), diff, fill=tc + (255,), font=font_body)

        if fname.endswith(".jpg"):
            out_path = os.path.join(OUT, "profits2.jpg")
            im.convert("RGB").save(out_path, quality=92)
        else:
            out_path = os.path.join(OUT, fname)
            im.save(out_path)
        print("wrote", out_path)


if __name__ == "__main__":
    main()
