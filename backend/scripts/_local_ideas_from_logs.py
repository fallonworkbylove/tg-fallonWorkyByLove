#!/usr/bin/env python3
"""Classify live bot replies + brainstorm NEW post-filter ideas via local Ollama."""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
CLS_MODEL = os.environ.get("IDEA_MODEL", "gemma2:9b")
BRAIN_MODEL = os.environ.get("BRAIN_MODEL", "qwen2.5:7b-instruct")

HEUR = [
    (re.compile(r"продолж[а-яё]*\s+общен|продолжать\s+общен", re.I), "chat-continuity"),
    (re.compile(r"всегда\s+нужно\s+радов|иногда\s+просто\s+нужно", re.I), "moral"),
    (re.compile(r"надеюсь,?\s*(?:не\s+разочарую|тебе\s+понравится)", re.I), "soft-sell"),
    (re.compile(r"под\s+контролем|вс[её]\s+под\s+контрол", re.I), "corporate"),
    (re.compile(r"с\s+чего\s+начн|what'?s\s+on\s+your\s+mind|How'?s\s+your\s+day", re.I), "en-stiff"),
    (re.compile(r"^эм,?\s+", re.I), "lead-em"),
    (re.compile(r"постараюсь\)?\s*$", re.I), "vague-promise"),
    (re.compile(r"рада\s+знаком|приятно\s+познаком", re.I), "stiff-greeting"),
    (re.compile(r"просто\s+так,?\s*вс[её]\s+ок", re.I), "hollow"),
]


def chat(model: str, system: str, user: str, temp: float = 0.2, npred: int = 900) -> str:
    body = json.dumps(
        {
            "model": model,
            "stream": False,
            "options": {"temperature": temp, "num_predict": npred},
            "messages": [
                {"role": "system", "content": system},
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
    return str((out.get("message") or {}).get("content") or "")


def heuristic(bot: str) -> str | None:
    bare = re.sub(r"<<[^>]+>>", "", bot).strip()
    for rx, tag in HEUR:
        if rx.search(bare):
            return tag
    if len(bare.split()) <= 2 and bare.lower() in {"хех", "хах", "эм", "ок", "да"}:
        return "too-short"
    return None


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "tmp_live_pairs.json")
    raw = path.read_text(encoding="utf-8")
    raw = re.sub(r"^[^\[]+", "", raw, count=1).strip()
    pairs = json.loads(raw)[:36]
    bots = [str(p.get("bot") or p.get("a") or "")[:180] for p in pairs]

    lines = [f"{i}. ОНА: {b}" for i, b in enumerate(bots)]
    cls_prompt = (
        "Классифицируй ответы девушки в Telegram. Одна строка на номер:\n"
        "N BAD|OK category\n"
        "category: corporate, moral, soft-sell, en-stiff, lead-filler, hollow, "
        "vague-promise, chat-meta, stiff-greeting, bare-ack, other, ok\n"
        "BAD = звучит как бот/колл-центр/мудрость/сервис.\n\n"
        + "\n".join(lines)
    )
    print(f"classify model={CLS_MODEL} n={len(bots)}", flush=True)
    try:
        cls_raw = chat(
            CLS_MODEL,
            "Только строки вида '0 BAD corporate'. Без пояснений.",
            cls_prompt,
            0.1,
            800,
        )
    except Exception as e:
        print(f"classify fail: {e}", flush=True)
        cls_raw = ""

    model_map: dict[int, tuple[str, str]] = {}
    for m in re.finditer(r"(?m)^\s*(\d+)\s*[.):\-]?\s*(BAD|OK)\s+([a-z0-9\-]+)", cls_raw, re.I):
        model_map[int(m.group(1))] = (m.group(2).upper(), m.group(3).lower())

    rows = []
    for i, bot in enumerate(bots):
        h = heuristic(bot)
        mv, mc = model_map.get(i, ("", ""))
        verdict = "BAD" if h or mv == "BAD" else (mv or "OK")
        cat = h or mc or ("ok" if verdict == "OK" else "other")
        rows.append({"i": i, "verdict": verdict, "category": cat, "heuristic": h, "model": f"{mv} {mc}".strip() or None, "bot": bot})

    bad = [r for r in rows if r["verdict"] == "BAD"]
    out_cls = path.with_name(path.stem + "_classified.json")
    out_cls.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(rows, ensure_ascii=False, indent=2))
    print(f"\n# BAD {len(bad)}/{len(rows)} -> {out_cls}", flush=True)

    if not bad:
        print("no BAD to brainstorm", flush=True)
        return 0

    bad_block = "\n".join(f"- [{r['category']}] {r['bot']}" for r in bad[:18])
    brain_prompt = (
        "Ниже BAD-ответы Telegram-бота (девушка). Уже есть фильтры на лесть, ну ок, "
        "точки, double bubble, реакции, продолжим общение.\n\n"
        f"{bad_block}\n\n"
        "Придумай 6 НОВЫХ конкретных post-filter идей (regex/замена), которых ещё нет в списке выше.\n"
        "Формат строго:\n"
        "N. PATTERN → REPLACE\n"
        "одна строка на идею. Без этики. На русском."
    )
    print(f"\nbrainstorm model={BRAIN_MODEL}", flush=True)
    try:
        ideas = chat(
            BRAIN_MODEL,
            "Коротко, только список PATTERN → REPLACE.",
            brain_prompt,
            0.55,
            700,
        )
    except Exception as e:
        ideas = f"brainstorm fail: {e}"
    out_ideas = path.with_name(path.stem + "_ideas.txt")
    out_ideas.write_text(ideas, encoding="utf-8")
    print("\n=== IDEAS ===")
    print(ideas)
    print(f"\n# wrote {out_ideas}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
