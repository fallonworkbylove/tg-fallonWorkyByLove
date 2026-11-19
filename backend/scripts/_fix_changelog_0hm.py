# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(__file__).resolve().parents[2] / "CHANGELOG_TG.md"
t = p.read_text(encoding="utf-8")
start = t.find("## 0hm. 2")
end = t.find("## 0hl. 2")
if start < 0 or end < 0:
    raise SystemExit(f"markers missing {start=} {end=}")

block = (
    "## 0hm. 2 ноя — анти-кайф echo + smoke\n\n"
    "`breakKaifEcho`: юзер на «кайф» → сразу увод; ≥1 своё «кайф» в хвосте → не эхо; "
    "голое «кайф)» → другой ack. Хинты меньше толкают «кайф». Smoke `_smoke_kaif_0hm.js`. "
    "Скиллы: phrase-bank, login-proxy; agents: deslop, blast-radius. "
    "Лента: (updates.js?v=142).\n\n"
)
p.write_text(t[:start] + block + t[end:], encoding="utf-8")
body = p.read_text(encoding="utf-8")[start : start + 60]
assert "breakKaifEcho" in body and "\x08" not in body, repr(body)
print("CHANGELOG_0HM_FIXED")
