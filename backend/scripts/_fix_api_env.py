#!/usr/bin/env python3
from pathlib import Path

base = Path("/root/opt/tgbot/tg-miniapp-loverussian/backend")
p = base / ".env"
baks = sorted(base.glob(".env.env.bak-api-*"), reverse=True)
if not baks:
    # try restore from literal-\n corruption using .env.save
    for name in (".env.save", ".env.bak-proxy-order", ".env.bak.20260928143542"):
        cand = base / name
        if cand.exists():
            baks = [cand]
            break
assert baks, "no backup found"
src = baks[0]
text = src.read_text(encoding="utf-8")
# if current looks like escaped one-liner, ignore it
print("restoring from", src)
lines = []
for line in text.splitlines():
    if line.startswith("TELEGRAM_API_ID="):
        lines.append("TELEGRAM_API_ID=37351004")
    elif line.startswith("TELEGRAM_API_HASH="):
        lines.append("TELEGRAM_API_HASH=8c5f05a6a619d383a1a3a335c246c0b5")
    else:
        lines.append(line)
out = "\n".join(lines)
if text.endswith("\n"):
    out += "\n"
p.write_text(out, encoding="utf-8")
print("lines", len(lines))
for line in p.read_text(encoding="utf-8").splitlines():
    if line.startswith("TELEGRAM_API_") or line.startswith("PORT=") or line.startswith("DB_HOST="):
        print(line)
