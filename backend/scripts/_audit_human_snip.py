#!/usr/bin/env python3
"""Extract recent user/bot lines with context for human-feel audit."""
import re
from pathlib import Path

out = Path("/root/.pm2/logs/tgbot-out.log").read_bytes()[-2_000_000:].decode("utf-8", "replace")

# Collect chronological chat-ish lines
lines = []
for m in re.finditer(
    r"\[([^\]]+)\]\s+(Ответ для\s+)?([^:\n]{1,50}):\s+\"([^\"]{1,320})\"",
    out,
):
    acct = m.group(1).strip()
    is_bot = bool(m.group(2))
    peer = m.group(3).strip()
    text = m.group(4).replace("\\n", " / ")
    if any(x in peer for x in ("Скан", "Пауза", "Слишком", "дочитываю")):
        continue
    lines.append((acct, peer, "BOT" if is_bot else "USER", text))

# Print last 90 as stream
print("=== LAST 90 CHAT LINES ===")
for acct, peer, kind, text in lines[-90:]:
    short_acct = acct.split("—")[-1].strip()[:18] if "—" in acct else acct[:18]
    print(f"[{short_acct}] {peer} {kind}: {text}")

# Flag bot lines that look coach/corporate/inhuman
print("\n=== INHUMAN-ISH BOT LINES ===")
rxs = [
    (r"зависит от восприятия|интересный поворот|оценить ситуацию|надеяться на лучшее|хороший подход|можно попробовать подумать|обсудить план|каждый[уа] сво[её]|нужно иногда отдыхать|отдых по полной|такое бывает|Представь,?\s+что|представь,?\s+что", "coach"),
    (r"^(?:жесть|капец|капец,?\s*жесть|ну типо капец).{0,20}$", "filler_zhest"),
    (r"сложно так сразу|хз сразу|ну смотря как", "evasion"),
    (r"просто познакомиться|рада знакомству", "anketa"),
    (r"это хороший подход|дальше ждем|можно пообщаться с коллегами", "corporate"),
]
seen = set()
for acct, peer, kind, text in lines:
    if kind != "BOT":
        continue
    hits = [n for rx, n in rxs if re.search(rx, text, re.I)]
    if not hits:
        continue
    key = text.lower()[:80]
    if key in seen:
        continue
    seen.add(key)
    print(f"  [{hits}] {peer}: {text}")
