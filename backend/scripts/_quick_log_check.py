#!/usr/bin/env python3
"""Quick post-fix log check: errors since restart + recent replies + flags."""
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

OUT = Path("/root/.pm2/logs/tgbot-out.log")
ERR = Path("/root/.pm2/logs/tgbot-error.log")

err = ERR.read_bytes()[-200_000:].decode("utf-8", "replace") if ERR.exists() else ""
out = OUT.read_bytes()[-700_000:].decode("utf-8", "replace") if OUT.exists() else ""

print("=== ERR ===")
print("mtime", datetime.fromtimestamp(ERR.stat().st_mtime, tz=timezone.utc).isoformat())
print("size", ERR.stat().st_size)
c = Counter()
other = []
for line in err.splitlines()[-400:]:
    if "sessionForgetHint" in line:
        c["sessionForgetHint"] += 1
    elif "прокси" in line and "недоступен" in line:
        c["proxy_fail"] += 1
    elif "helpRequestNotifier" in line:
        c["help_poll"] += 1
    elif "Пустой AI" in line:
        c["empty_ai"] += 1
    elif any(x in line for x in ("Ошибка", "Error", "ReferenceError", "TypeError", "is not defined")):
        c["other"] += 1
        s = line.strip()[-180:]
        if s not in other and len(other) < 15:
            other.append(s)
print("counts_last400", dict(c))
for o in other:
    print("OTHER:", o)
# last 8 err lines
print("--- last err lines ---")
for line in err.splitlines()[-12:]:
    print(line[-200:])

print("\n=== RECENT BOT REPLIES ===")
bots = []
for m in re.finditer(r"\[([^\]]+)\]\s+Ответ для\s+([^:]+):\s+\"([^\"]{1,260})\"", out):
    bots.append((m.group(1), m.group(2).strip(), m.group(3)))
print(f"replies_in_tail={len(bots)}")
for a, p, t in bots[-45:]:
    short = a.split("—")[-1].strip()[:16] if "—" in a else a[:16]
    print(f"[{short}] {p}: {t}")

flags = [
    (r"восприятия|интересный поворот|хороший подход|надеяться на лучшее|не теряй надежд|всегда есть шанс|обсудить план|оценить ситуацию|сосредоточиться на своих|буря эмоций", "coach"),
    (r"сложно так сразу|хз сразу", "evasion"),
    (r"нужно иногда отдыхать|каждому сво[её]|отдых по полной", "empty_nod"),
    (r"sessionForget|не гони|может быть\s*\)?$", "bad"),
    (r"инст|instagram\.com|\[ссылк", "contact"),
]
print("\n=== FLAGGED (last 80) ===")
seen = set()
n = 0
for a, p, t in bots[-80:]:
    hits = [name for rx, name in flags if re.search(rx, t, re.I)]
    if hits:
        k = t.lower()[:60]
        if k in seen:
            continue
        seen.add(k)
        n += 1
        print(f"  {hits} {p}: {t}")
if not n:
    print("  (none)")

# pairs peek: last user+bot per peer roughly
print("\n=== LAST USER LINES (sample) ===")
users = []
for m in re.finditer(r"\[([^\]]+)\]\s+(?!Ответ для)([^:\n]{2,40}):\s+\"([^\"]{1,200})\"", out):
    peer = m.group(2).strip()
    if any(x in peer for x in ("Скан", "Пауза", "Слишком", "дочитываю", "Отправлен")):
        continue
    users.append((m.group(1).split("—")[-1].strip()[:14], peer[:28], m.group(3)))
for a, p, t in users[-20:]:
    print(f"[{a}] {p}: {t}")
