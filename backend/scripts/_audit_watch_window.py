#!/usr/bin/env python3
"""Deep-dive recent out/err after a watch window."""
from pathlib import Path
import re

out = Path("/root/.pm2/logs/tgbot-out.log").read_bytes()[-150_000:].decode("utf-8", "replace")
err = Path("/root/.pm2/logs/tgbot-error.log").read_bytes()[-8_000:].decode("utf-8", "replace")

print("=== ERR RECENT ===")
print(err[-2500:])

print("\n=== OUT ERROR/WARN LINES ===")
pat = re.compile(
    r"Ошибка|error|fail|пустой|не разобрал|FLOOD|unsupported|fetch failed|"
    r"ReferenceError|TypeError|is not a function|long polling|не удалось",
    re.I,
)
for line in out.splitlines():
    if pat.search(line):
        print(line[:240])

print("\n=== SHORT / WEAK REPLIES ===")
weak_rx = re.compile(
    r"не торопиться|всё будет хорошо|все будет ок|важно ценить|поддержка важна|"
    r"правильно питаться|радость, когда|не переживай|главное быть в форме",
    re.I,
)
for m in re.finditer(r"Ответ для\s+([^:]+):\s+\"([^\"]*)\"", out):
    peer, text = m.group(1).strip(), m.group(2).strip()
    flags = []
    if len(text) <= 10:
        flags.append("short")
    if text.endswith((" был", " по делу", " типо")) or text.endswith(" "):
        flags.append("cut?")
    if weak_rx.search(text):
        flags.append("coachish")
    if flags:
        print(f"  {flags} {peer[:24]}: {text}")

print("\n=== MULTI PAUSES (>=3) ===")
pauses = {}
for m in re.finditer(r"Пауза (\d+)с перед ответом для ([^.]+)\.", out):
    pauses.setdefault(m.group(2).strip(), []).append(int(m.group(1)))
for peer, vals in sorted(pauses.items(), key=lambda x: -len(x[1])):
    if len(vals) >= 3:
        print(f"  {peer}: n={len(vals)} pauses={vals}")

print("\n=== AUTOREPLY / ARCHIVE SKIPS ===")
for line in out.splitlines():
    if any(s in line for s in ("Автоответ отключ", "в архиве", "архив", "operator_pause")):
        print(line[:220])
