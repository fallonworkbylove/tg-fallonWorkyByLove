#!/usr/bin/env python3
import re
from pathlib import Path

base = Path(__file__).resolve().parents[1] / "services"
paths = {
    "oct12": base / "aiResponder.js.bak-2026-10-12-pre-daytest",
    "oct1_live": base / "aiResponder.js",
}

for label, path in paths.items():
    if not path.exists():
        print(label, "MISSING")
        continue
    t = path.read_text(encoding="utf-8", errors="replace")
    longs = []
    longs += re.findall(r"`([^`]{100,8000})`", t)
    longs += re.findall(r"'([^']{100,4000})'", t)
    longs += re.findall(r'"([^"]{100,4000})"', t)
    rem = [
        s
        for s in longs
        if re.search(
            r"НЕ |ЗАПРЕЩ|пиши|отвеч|девушк|Telegram|коуч|вопрос|ОБЯЗАТ|веди себя|обычн",
            s,
            re.I,
        )
    ]
    chars = sum(len(s) for s in rem)
    sys_re = re.compile(r"role:\s*'system'")
    print(
        label,
        "lines=",
        t.count("\n") + 1,
        "fix=",
        len(re.findall(r"^function fix[A-Z]", t, re.M)),
        "hints=",
        len(re.findall(r"^function build\w*Hint", t, re.M)),
        "system_refs=",
        len(sys_re.findall(t)),
        "instr_chars~",
        chars,
        "instr_tokens~",
        chars // 3,
    )
