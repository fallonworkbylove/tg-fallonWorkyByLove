# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"C:\Users\lox\Downloads\AyuGram Desktop\ChatExport_2026-10-28")
OUT = Path(r"C:\Users\lox\Desktop\tg-fallonWorkyByLove-main\tmp_human_dialog.txt")


def parse(path: Path):
    html = path.read_text(encoding="utf-8", errors="ignore")
    parts = re.split(r'<div class="message default[^"]*"', html)
    out = []
    for p in parts[1:]:
        mdate = re.search(r'class="pull_right date details" title="([^"]+)"', p)
        date = mdate.group(1) if mdate else ""
        mf = re.search(r'<div class="from_name">\s*([^<]+)', p)
        fr = re.sub(r"\s+", " ", mf.group(1)).strip() if mf else "(cont)"
        texts = re.findall(r'<div class="text">(.*?)</div>', p, re.S)
        text = " | ".join(re.sub(r"<[^>]+>", "", t) for t in texts)
        text = re.sub(r"\s+", " ", text).strip()
        media = []
        if "media_photo" in p or "photo_wrap" in p:
            media.append("photo")
        if "media_voice_message" in p or "Media voice" in p:
            media.append("voice")
        if "media_video" in p or "round_video" in p or "video_file_wrap" in p:
            media.append("video")
        if re.search(r'class="[^"]*sticker', p):
            media.append("sticker")
        if "Media file" in p:
            media.append("file")
        out.append({"date": date, "from": fr, "text": text, "media": media, "file": path.name})
    return out


msgs = []
for name in ("messages.html", "messages2.html"):
    p = ROOT / name
    if p.exists():
        chunk = parse(p)
        print(name, "messages", len(chunk))
        msgs.extend(chunk)

last = ""
for m in msgs:
    if m["from"] and m["from"] != "(cont)":
        last = m["from"]
    elif m["from"] == "(cont)":
        m["from"] = last

names = sorted({m["from"] for m in msgs if m["from"]})
print("NAMES:", names)
print("TOTAL:", len(msgs))

with OUT.open("w", encoding="utf-8") as f:
    for m in msgs:
        med = (" [" + ",".join(m["media"]) + "]") if m["media"] else ""
        f.write(f"{m['file']}\t{m['date']}\t{m['from']}\t{m['text']}{med}\n")
print("WROTE", OUT)
