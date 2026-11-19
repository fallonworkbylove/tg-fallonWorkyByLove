#!/usr/bin/env python3
"""Brainstorm NEW humanize post-filters via local Ollama. Write UTF-8 file."""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
MODELS = [
    os.environ.get("BRAIN_MODEL", "qwen2.5:7b-instruct"),
    "gemma2:9b",
    "mistral-nemo:latest",
]

ALREADY = """
Уже есть фильтры (НЕ предлагай то же самое):
лесть/рада общению, ну ок баги, как дел, EN actually/keeping it chill,
точки в конце, ну/хах спам в начале, продолжим общение, под контролем,
постараюсь, с чего начнём, наслаждаться жизнью, ищу знакомых, было бы ну ок,
хех lone, недалеко/близко дубль, собираю вещи мимо темы, сериалы и кофе анкета,
называется обрыв, иногда нужно, привет+переезд, Glad you think so, and a bit,
посмотрим что будет дальше, double bubble, реакции на ок/ага.
"""

BAD_LIVE = """
Свежие сомнительные ответы из логов (часть уже режется, ищи НОВЫЕ паттерны):
- хай
- да просто общаюсь
- ну, иногда нужно
- короче чем занят сегодня?
- смотрела вчера новый сериал, интересный, про путешествия
- называется 
- хах, ну да, было бы прикольно
- Haha, you're sweet
- хм, да так, ничего особенного, просто кофе пью
- привет) переезжаю из Липецка в Архангельск
- I'd say I'm caring and a bit
- хах, не знаю, просто переписываюсь
- не скажу) стройная, этого достаточно
- не, не играю, просто общаюсь
- A bit playful, I guess
- ну спасибо
- иногда сериалы смотрю
- хах ладно чуть позже)
- да так, поболтать
- Glad you think so
- ок, скажу
- I can be both, depends on the situation
- жесть, это не очень) надеюсь, скоро восстановят
- сечас в Липецке... ищу новых знакомых и общения)
- это было бы ну ок)
- цели? просто развиваться и наслаждаться жизнью)
- тянет, конечно, но держусь)
- да, давай продолжим общение) готова, посмотрим, что будет дальше
- игра престолов» пересматриваю
"""

PROMPT = f"""Ты помогаешь улучшить Telegram-бота (девушка, RU/EN).
{ALREADY}

{BAD_LIVE}

Задача: 8 НОВЫХ идей post-filter (после ответа модели, regex/замена).
Только то, чего НЕТ в списке «уже есть».
Фокус: шаблоны, обрывы, мимо темы, колл-центр, анкета, EN-офис.

Формат СТРОГО по одной строке:
N. «точная фраза или regex-смысл» → «на что заменить» (почему 3-5 слов)

Без этики. Без «добавь эмодзи». Без «задавай больше вопросов».
Без замены ок→окей / ладно→хорошо.
"""


def chat(model: str) -> str:
    body = json.dumps(
        {
            "model": model,
            "stream": False,
            "options": {"temperature": 0.4, "num_predict": 900},
            "messages": [
                {
                    "role": "system",
                    "content": "Короткий список. Только строки N. «…» → «…».",
                },
                {"role": "user", "content": PROMPT},
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


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    out_path = Path(
        sys.argv[1]
        if len(sys.argv) > 1
        else "tmp_brainstorm_ideas.txt"
    )
    chunks = []
    for model in MODELS:
        print(f"=== {model} ===", flush=True)
        try:
            text = chat(model)
        except Exception as e:
            text = f"(fail: {e})"
        chunks.append(f"## {model}\n{text}\n")
        print(text[:1200], flush=True)
        print(flush=True)
    out_path.write_text("\n".join(chunks), encoding="utf-8")
    print(f"wrote {out_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
