#!/usr/bin/env python3
"""Heuristic severity audit of bot replies + optional Ollama classify."""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.environ.get("IDEA_MODEL", "gemma2:9b")

# (severity, severity small|medium|large, category, regex)
RULES: list[tuple[str, str, str, re.Pattern[str]]] = [
    ("large", "offtopic-move", re.compile(r"собираю\s+вещи|с\s+коробк|переезжа.{0,40}из\s+\S+\s+в\s+", re.I)),
    ("large", "chat-continuity", re.compile(r"продолж[а-яё]*\s+общен|посмотрим,?\s+что\s+будет\s+дальше", re.I)),
    ("large", "anketa-hobby", re.compile(r"сериалы\s+и\s+кофе|обожаю\s+сериалы|простая\s+девчонк", re.I)),
    ("large", "life-goals", re.compile(r"развиваться\s+и\s+наслаждаться|наслаждаться\s+жизн", re.I)),
    ("large", "incomplete", re.compile(r"называется\s*\)*$|and a bit\s*$|иногда\s+нужно\s*\)*$", re.I)),
    ("medium", "corporate", re.compile(r"под\s+контрол|всегда\s+нужно|иногда\s+просто\s+нужно", re.I)),
    ("medium", "soft-sell", re.compile(r"надеюсь,?\s*(?:не\s+разочарую|тебе\s+понравится)|постараюсь\s*\)*$", re.I)),
    ("medium", "seeking", re.compile(r"ищу\s+новых\s+знаком|просто\s+общаюсь|просто\s+переписываюсь|да\s+так,?\s+поболтать", re.I)),
    ("medium", "en-stiff", re.compile(r"Hey there|what'?s on your mind|Glad you think so|age is just a number|depends on the situation|I'?d say I'?m", re.I)),
    ("medium", "hollow-hope", re.compile(r"надеюсь,?\s+скоро\s+восстанов", re.I)),
    ("medium", "vague-series", re.compile(r"новый\s+сериал.{0,40}интересн", re.I)),
    ("medium", "greeting-move", re.compile(r"^(?:привет|приветик|хай).{0,10}переезж", re.I)),
    ("medium", "body-dodge", re.compile(r"не\s+скажу\).{0,20}стройн", re.I)),
    ("small", "lead-em", re.compile(r"^эм[,\s]+", re.I)),
    ("small", "orphan-quote", re.compile(r"(?<!«)»|(?:^|[^«])»", re.I)),
    ("small", "typo-sechas", re.compile(r"\bсечас\b", re.I)),
    ("small", "double-filler", re.compile(r"^(?:хах|ахах|ну).{0,8}(?:хах|ахах|ну)", re.I)),
    ("small", "bare-ack", re.compile(r"^(?:ну\s+)?(?:ок|ага|угу|поняла|норм|да)\s*\)*$", re.I)),
    ("small", "later-promise", re.compile(r"чуть\s+позже\s*\)*$|ок,?\s*скажу\s*\)*$", re.I)),
    ("small", "smoke-template", re.compile(r"тянет,?\s+конечно,?\s+но\s+держ", re.I)),
]


def severity_rank(s: str) -> int:
    return {"large": 0, "medium": 1, "small": 2}.get(s, 9)


def audit_one(bot: str) -> list[dict]:
    hits = []
    for sev, cat, rx in RULES:
        if rx.search(bot):
            hits.append({"severity": sev, "category": cat})
    return hits


def ollama_flag_bads(bots: list[str]) -> dict[int, str]:
    lines = [f"{i}. {b[:140]}" for i, b in enumerate(bots[:40])]
    user = (
        "Отметь BAD ответы девушки в TG. Строка: N BAD reason\n"
        "reason одно слово: offtopic, anketa, incomplete, corporate, en-stiff, hollow, other\n"
        "Только BAD, OK пропускай.\n\n" + "\n".join(lines)
    )
    body = json.dumps(
        {
            "model": MODEL,
            "stream": False,
            "options": {"temperature": 0.1, "num_predict": 600},
            "messages": [
                {"role": "system", "content": "Только строки 'N BAD reason'."},
                {"role": "user", "content": user},
            ],
        },
        ensure_ascii=False,
    ).encode()
    req = urllib.request.Request(
        f"{OLLAMA}/api/chat", data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=240) as r:
        msg = str((json.loads(r.read().decode()).get("message") or {}).get("content") or "")
    found: dict[int, str] = {}
    for m in re.finditer(r"(?m)^\s*(\d+)\s+BAD\s+([a-z0-9\-]+)", msg, re.I):
        found[int(m.group(1))] = m.group(2).lower()
    return found


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "tmp_audit_replies.json")
    rows = json.loads(path.read_text(encoding="utf-8"))
    bots = [str(r.get("bot") or "") for r in rows]

    model_bad: dict[int, str] = {}
    try:
        model_bad = ollama_flag_bads(bots)
        print(f"ollama BAD marks: {len(model_bad)}", flush=True)
    except Exception as e:
        print(f"ollama skip: {e}", flush=True)

    findings = []
    for i, bot in enumerate(bots):
        hits = audit_one(bot)
        if not hits and i in model_bad:
            hits = [{"severity": "medium", "category": f"model-{model_bad[i]}"}]
        elif i in model_bad and hits:
            hits.append({"severity": "medium", "category": f"model-{model_bad[i]}"})
        if not hits:
            continue
        top = sorted(hits, key=lambda h: severity_rank(h["severity"]))[0]
        findings.append(
            {
                "i": i,
                "severity": top["severity"],
                "categories": [h["category"] for h in hits],
                "bot": bot[:200],
            }
        )

    findings.sort(key=lambda f: (severity_rank(f["severity"]), f["i"]))
    out = path.with_name(path.stem + "_findings.json")
    out.write_text(json.dumps(findings, ensure_ascii=False, indent=2), encoding="utf-8")

    by = {"large": [], "medium": [], "small": []}
    for f in findings:
        by.setdefault(f["severity"], []).append(f)

    print(f"\n# TOTAL findings {len(findings)}/{len(bots)}")
    for sev in ("large", "medium", "small"):
        print(f"\n## {sev.upper()} ({len(by.get(sev, []))})")
        for f in by.get(sev, [])[:25]:
            cats = ",".join(f["categories"])
            print(f"- [{cats}] {f['bot']!r}")

    print(f"\n# wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
