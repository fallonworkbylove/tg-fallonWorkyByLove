#!/usr/bin/env python3
from pathlib import Path

API_ID = "2496"
API_HASH = "8da85b0d5bfe62527e5b244c209159c3"

p = Path("/root/opt/tgbot/tg-miniapp-loverussian/backend/.env")
text = p.read_text(encoding="utf-8")
# refuse if file looks corrupted (literal \n one-liner)
if "\\n" in text and text.count("\n") < 5:
    raise SystemExit("refusing: .env looks corrupted (escaped newlines)")

lines = []
seen_id = seen_hash = False
for line in text.splitlines():
    if line.startswith("TELEGRAM_API_ID="):
        lines.append(f"TELEGRAM_API_ID={API_ID}")
        seen_id = True
    elif line.startswith("TELEGRAM_API_HASH="):
        lines.append(f"TELEGRAM_API_HASH={API_HASH}")
        seen_hash = True
    else:
        lines.append(line)

if not seen_id:
    lines.append(f"TELEGRAM_API_ID={API_ID}")
if not seen_hash:
    lines.append(f"TELEGRAM_API_HASH={API_HASH}")

out = "\n".join(lines)
if text.endswith("\n"):
    out += "\n"
p.write_text(out, encoding="utf-8")
print("ok lines", len(lines))
for line in p.read_text(encoding="utf-8").splitlines():
    if line.startswith("TELEGRAM_API_"):
        print(line)
