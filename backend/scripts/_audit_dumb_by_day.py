#!/usr/bin/env python3
"""Count 'dumb reply' patterns per day from pm2 out logs."""
import re
import os

FILES = [
    ("10-09", "/root/.pm2/logs/tgbot-out__2026-10-09_00-00-00.log"),
    ("10-10", "/root/.pm2/logs/tgbot-out__2026-10-10_00-00-00.log"),
    ("10-11", "/root/.pm2/logs/tgbot-out__2026-10-11_00-00-00.log"),
    ("10-12a", "/root/.pm2/logs/tgbot-out__2026-10-12_00-00-00.log"),
    ("10-12b", "/root/.pm2/logs/tgbot-out.log"),
]

PATTERNS = {
    "dodge": re.compile(
        r"сложно так сразу|не знаю сходу|хз сразу|короче хз|ну смотря|как получится|"
        r"потом расскажу|сама не решила|по-разному|хз пока|мм ещё думаю",
        re.I,
    ),
    "coach": re.compile(
        r"хороший подход|восприятия|нужно остановиться|каждому сво|такое бывает|"
        r"занятыми станови|интересный поворот|надо подумать|главное не торопи",
        re.I,
    ),
    "weak_nod": re.compile(
        r'Ответ для .+?: "(?:ага|угу|ну да|поняла|ого|жесть|ок|ладно)\s*\)?"\s*$',
        re.I | re.M,
    ),
    "service": re.compile(
        r"ок,? спасибо|уточни,? пожалуйста|рада (?:видеть|слышать)|не поняла, что спросил",
        re.I,
    ),
    "editorial": re.compile(r"шутник|про стиль|прям молодец|память хорош", re.I),
}


def main():
    for label, path in FILES:
        if not os.path.exists(path):
            print(label, "MISSING")
            continue
        data = open(path, "rb").read().decode("utf-8", "replace")
        reply_lines = [ln for ln in data.splitlines() if "Ответ для" in ln]
        n = len(reply_lines)
        blob = "\n".join(reply_lines)
        print(f"\n=== {label} reply_lines={n} ===")
        total_bad = 0
        for name, rx in PATTERNS.items():
            c = len(rx.findall(blob))
            total_bad += c
            pct = (100.0 * c / n) if n else 0
            print(f"  {name:10s} {c:5d}  ({pct:.1f}%)")
        pct_bad = (100.0 * total_bad / n) if n else 0
        print(f"  {'BAD_SUM':10s} {total_bad:5d}  ({pct_bad:.1f}% hits/replies)")


if __name__ == "__main__":
    main()
