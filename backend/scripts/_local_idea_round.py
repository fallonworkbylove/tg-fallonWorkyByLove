#!/usr/bin/env python3
"""
Локальный круг идей для humanization.

Роль локальной модели: только классификация BAD/OK + категория.
Переписывание реплик — руками/агентом (локалки на AFTER стабильно лажают).

Usage:
  # pairs.json: [{"user":"...","bot":"..."}] или [{"u":"...","a":"..."}]
  python backend/scripts/_local_idea_round.py tmp_round_pairs.json

Env:
  OLLAMA_URL=http://127.0.0.1:11434
  IDEA_MODEL=gemma2:9b
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.environ.get("IDEA_MODEL", "gemma2:9b")

HEUR = [
    (re.compile(r"рада\s+знакомству|приятно\s+познакомиться", re.I), "stiff-greeting"),
    (re.compile(r"родом\s+оттуда", re.I), "dry-city"),
    (re.compile(r"гибкий\s+график|работаю\s+онлайн,\s*гибкий", re.I), "hr-job"),
    (re.compile(r"надеюсь,?\s+у\s+тебя\s+тоже", re.I), "mirror-wish"),
    (re.compile(r"ну\s+что\s+молчишь|ну\s+ты\s+где\s*\)*$", re.I), "silent-poke"),
    (re.compile(r"сплю\s+глазами|погода\s+тут\s+реально\s*\)*$", re.I), "gibberish"),
    (re.compile(r"времени\s+нет|дела\s+с\s+переезд|пока\s+только\s+переписк", re.I), "dry-meet"),
    (re.compile(r"с\s+машиной\s+проще|всегда\s+удобнее", re.I), "travel-platitude"),
    (re.compile(r"просто\s+общение|ничего\s+конкретного", re.I), "seeking-template"),
    (re.compile(r"цифров\w*\s+актив|типа\s+криптовалют", re.I), "crypto-wiki"),
    (re.compile(r"всегда\s+(?:норм|удобн|хорош)|полезн[а-яё]*\s+штук|новый\s+этап", re.I), "corporate"),
    (re.compile(r"связь\s+восстанов", re.I), "meta-connection"),
    (re.compile(r"напомни|не\s+очень\s+выгляжу", re.I), "defer-photo"),
    (re.compile(r"редко\s+кто\s+пишет", re.I), "lonely"),
    (re.compile(r"^(?:поняла|спасиб[оа]?|спс|ага|угу|ок|окей|мило|взаимно)\s*\)*$", re.I), "bare-ack"),
    (re.compile(r"а\s+ты\s*\?|чем\s+занят\?", re.I), "and-you-tail"),
    (re.compile(r"Sounds good|Aww, that's|Right\?", re.I), "en-stiff"),
]


def norm_pair(p: dict) -> dict:
    return {
        "user": str(p.get("user") or p.get("u") or "")[:200],
        "bot": str(p.get("bot") or p.get("a") or "")[:200],
        "chat": str(p.get("chat") or p.get("peer") or ""),
    }


def heuristic(bot: str) -> str | None:
    bare = re.sub(r"<<[^>]+>>", "", bot).strip()
    for rx, tag in HEUR:
        if rx.search(bare):
            return tag
    words = bare.split()
    if 0 < len(words) <= 3 and not bare.startswith("["):
        return "too-short"
    return None


def ollama_classify(pairs: list[dict]) -> str:
    lines = []
    for i, p in enumerate(pairs):
        lines.append(f"{i}. ОН: {p['user'][:140]}\n   ОНА: {p['bot'][:140]}")
    user = (
        "Примеры:\n"
        "0. ОН: Привет с дв | ОНА: привет) рада знакомству\n"
        "0 BAD stiff-greeting\n"
        "1. ОН: Где работаешь? | ОНА: работаю онлайн, гибкий график\n"
        "1 BAD hr-job\n"
        "2. ОН: Ну как спалось | ОНА: нормально, просто рано встала))\n"
        "2 OK ok\n\n"
        "Теперь классифицируй. На каждую пару одна строка: N BAD|OK category\n"
        "category: stiff-greeting, dry-city, hr-job, mirror-wish, silent-poke, "
        "gibberish, dry-meet, seeking-template, corporate, bare-ack, "
        "question-spam, invent-fact, other, ok\n\n"
        + "\n".join(lines)
    )
    body = json.dumps(
        {
            "model": MODEL,
            "stream": False,
            "options": {"temperature": 0.1, "num_predict": 700},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Ты классификатор. Отвечай только строками вида "
                        "'0 BAD stiff-greeting'. Без пояснений."
                    ),
                },
                {"role": "user", "content": user},
            ],
        },
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA}/api/chat",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=240) as r:
        out = json.loads(r.read().decode("utf-8"))
    msg = out.get("message") or {}
    return str(msg.get("content") or out.get("error") or "")


def parse_model_lines(text: str, n: int) -> dict[int, tuple[str, str]]:
    found: dict[int, tuple[str, str]] = {}
    for m in re.finditer(
        r"(?m)^\s*(\d+)\s*[.):\-]?\s*(BAD|OK)\s+([a-z0-9\-]+)",
        text,
        re.I,
    ):
        idx = int(m.group(1))
        if 0 <= idx < n:
            found[idx] = (m.group(2).upper(), m.group(3).lower())
    return found


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "tmp_round_pairs.json")
    raw = path.read_text(encoding="utf-8")
    # tolerate BOM / prefix junk
    raw = re.sub(r"^[^\[]+", "", raw, count=1).strip()
    pairs = [norm_pair(p) for p in json.loads(raw)[:24]]
    if not pairs:
        print("no pairs", file=sys.stderr)
        return 1

    print(f"model={MODEL} pairs={len(pairs)}", file=sys.stderr)
    model_text = ""
    try:
        model_text = ollama_classify(pairs)
    except Exception as e:
        print(f"ollama error: {e}", file=sys.stderr)

    model_map = parse_model_lines(model_text, len(pairs))
    rows = []
    for i, p in enumerate(pairs):
        h = heuristic(p["bot"])
        m_verdict, m_cat = model_map.get(i, ("", ""))
        verdict = "BAD" if h or m_verdict == "BAD" else (m_verdict or "OK")
        cat = h or m_cat or ("ok" if verdict == "OK" else "other")
        rows.append(
            {
                "i": i,
                "verdict": verdict,
                "category": cat,
                "heuristic": h,
                "model": f"{m_verdict} {m_cat}".strip() or None,
                "user": p["user"],
                "bot": p["bot"],
                "chat": p["chat"],
            }
        )

    out_path = path.with_name(path.stem + "_classified.json")
    out_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(rows, ensure_ascii=False, indent=2))
    print(f"\n# wrote {out_path}", file=sys.stderr)
    if model_text:
        print("\n--- raw model ---", file=sys.stderr)
        print(model_text[:1500], file=sys.stderr)
    bad = [r for r in rows if r["verdict"] == "BAD"]
    print(f"\n# BAD {len(bad)}/{len(rows)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
