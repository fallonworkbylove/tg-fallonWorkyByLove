#!/usr/bin/env python3
"""Analyze replies written during the last watch window from out log."""
import re
from pathlib import Path

out = Path("/root/.pm2/logs/tgbot-out.log").read_bytes()[-900_000:].decode("utf-8", "replace")
err = Path("/root/.pm2/logs/tgbot-error.log")
print("err_mtime", err.stat().st_mtime if err.exists() else None)
print("err_size", err.stat().st_size if err.exists() else 0)

# last bot replies
bots = []
for m in re.finditer(r"\[([^\]]+)\]\s+Ответ для\s+([^:]+):\s+\"([^\"]{1,280})\"", out):
    bots.append((m.group(1)[:40], m.group(2).strip()[:30], m.group(3)))

print(f"bot_replies_in_tail={len(bots)}")
print("=== LAST 40 BOT REPLIES ===")
for a, p, t in bots[-40:]:
    short = a.split("—")[-1].strip()[:16] if "—" in a else a[:16]
    print(f"[{short}] -> {p}: {t}")

flags = [
    (r"восприятия|интересный поворот|хороший подход|надеяться на лучшее|обсудить план|оценить ситуацию", "coach"),
    (r"сложно так сразу|хз сразу", "evasion"),
    (r"нужно иногда отдыхать|каждому сво[её]|отдых по полной|такое бывает\s*\)?$", "empty_nod"),
    (r"^(?:капец,?\s*)?жесть\s*\)?$|^(?:жесть,?\s*)?капец\s*\)?$", "zhest_only"),
    (r"инст|instagram\.com|держи\)|\[ссылк", "contact"),
    (r"не гони", "rude_show"),
    (r"может быть\s*\)?$", "maybe_hedge"),
]
print("\n=== FLAGGED ===")
seen = set()
for a, p, t in bots[-120:]:
    hits = [n for rx, n in flags if re.search(rx, t, re.I)]
    if hits:
        key = t.lower()[:70]
        if key in seen:
            continue
        seen.add(key)
        print(f"  {hits} {p}: {t}")
if not seen:
    print("  (none in last 120)")
