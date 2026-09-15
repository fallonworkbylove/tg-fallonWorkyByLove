#!/usr/bin/env python3
"""
Загрузка датасета и запуск fine-tuning gpt-4o-mini через OpenAI API.

Датасет готовится отдельно (см. export-finetune-dataset.js) — этот скрипт
только загружает уже готовый .jsonl файл, создаёт задание на обучение и
следит за его статусом до завершения.

Установка зависимостей (один раз):
    pip install openai python-dotenv

Использование:
    python3 finetune_openai.py --file ../training-data/finetune-dataset.jsonl \
        --base-model gpt-4o-mini-2024-07-18 \
        --suffix vika-v1

По завершении скрипт печатает готовый model id вида:
    ft:gpt-4o-mini-2024-07-18:org::abc123

Этот id нужно вписать в OPENAI_MODEL в .env бота (см. docs/FINE_TUNING.md).
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

try:
    from openai import OpenAI
except ImportError:
    print("Пакет openai не установлен. Выполни: pip install openai python-dotenv")
    sys.exit(1)


def load_env():
    """Подгружает .env из backend/.env, если python-dotenv установлен."""
    if load_dotenv is None:
        print("[warn] python-dotenv не установлен — переменные окружения берутся только из shell.")
        return
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
        print(f"[finetune] Загружен .env из {env_path}")
    else:
        print(f"[warn] .env не найден по пути {env_path} — используются переменные из shell.")


def build_client() -> OpenAI:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("Ошибка: OPENAI_API_KEY не задан ни в .env, ни в окружении.")
        sys.exit(1)
    base_url = os.environ.get("OPENAI_BASE_URL") or None
    # ВАЖНО: если бот работает через SOCKS5-прокси (см. aiResponder.js,
    # api.openai.com блокирует российские IP) — на машине, где запускается
    # ЭТОТ скрипт, тоже нужен доступ к api.openai.com. Проще всего гонять
    # fine-tuning с сервера/машины, у которой есть прямой доступ (например,
    # через VPN), либо экспортировать HTTPS_PROXY/ALL_PROXY перед запуском:
    #   export ALL_PROXY=socks5://user:pass@host:port
    #   python3 finetune_openai.py ...
    # httpx (используется openai-python) сам подхватывает эти переменные.
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
        print(f"[finetune] Базовый URL переопределён: {base_url}")
    return OpenAI(**kwargs)


def validate_jsonl(path: Path) -> int:
    """Быстрая локальная проверка формата перед отправкой — экономит время
    и деньги на случай кривого датасета."""
    count = 0
    with path.open("r", encoding="utf-8") as f:
        for i, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"[error] Строка {i}: невалидный JSON — {e}")
                sys.exit(1)
            messages = obj.get("messages")
            if not isinstance(messages, list) or len(messages) < 2:
                print(f"[error] Строка {i}: поле 'messages' должно быть списком минимум из 2 сообщений")
                sys.exit(1)
            roles = [m.get("role") for m in messages]
            if "assistant" not in roles:
                print(f"[error] Строка {i}: в примере нет сообщения с role='assistant'")
                sys.exit(1)
            count += 1
    if count < 10:
        print(f"[error] В датасете {count} примеров — OpenAI требует минимум 10 для запуска fine-tuning.")
        sys.exit(1)
    print(f"[finetune] Локальная проверка пройдена: {count} валидных примеров.")
    return count


def upload_file(client: OpenAI, path: Path) -> str:
    print(f"[finetune] Загружаю файл {path} ...")
    with path.open("rb") as f:
        uploaded = client.files.create(file=f, purpose="fine-tune")
    print(f"[finetune] Файл загружен, file_id = {uploaded.id}")
    return uploaded.id


def create_job(client: OpenAI, file_id: str, base_model: str, suffix: str | None) -> str:
    kwargs = {"training_file": file_id, "model": base_model}
    if suffix:
        kwargs["suffix"] = suffix
    job = client.fine_tuning.jobs.create(**kwargs)
    print(f"[finetune] Задание создано: job_id = {job.id}, статус = {job.status}")
    return job.id


def poll_job(client: OpenAI, job_id: str, poll_seconds: int = 30):
    """Опрашивает статус задания до финального состояния (succeeded/failed/cancelled)."""
    terminal_states = {"succeeded", "failed", "cancelled"}
    while True:
        job = client.fine_tuning.jobs.retrieve(job_id)
        print(f"[finetune] Статус: {job.status} (обновлено {time.strftime('%H:%M:%S')})")

        # Печатаем последние события — удобно видеть прогресс эпох обучения.
        try:
            events = client.fine_tuning.jobs.list_events(fine_tuning_job_id=job_id, limit=3)
            for ev in reversed(list(events.data)):
                print(f"    · {ev.message}")
        except Exception:
            pass

        if job.status in terminal_states:
            return job
        time.sleep(poll_seconds)


def main():
    parser = argparse.ArgumentParser(description="Запуск fine-tuning gpt-4o-mini на датасете диалогов бота.")
    parser.add_argument("--file", required=True, help="Путь к .jsonl датасету (см. export-finetune-dataset.js)")
    parser.add_argument(
        "--base-model",
        default="gpt-4o-mini-2024-07-18",
        help="Базовая модель для fine-tuning (по умолчанию gpt-4o-mini-2024-07-18)",
    )
    parser.add_argument("--suffix", default=None, help="Короткий суффикс для имени модели (напр. 'vika-v1')")
    parser.add_argument(
        "--poll-seconds", type=int, default=30, help="Интервал опроса статуса задания в секундах (по умолчанию 30)"
    )
    parser.add_argument(
        "--no-wait",
        action="store_true",
        help="Не ждать завершения — только создать задание и вывести job_id (проверять статус отдельно)",
    )
    args = parser.parse_args()

    load_env()

    dataset_path = Path(args.file).resolve()
    if not dataset_path.exists():
        print(f"Файл не найден: {dataset_path}")
        sys.exit(1)

    validate_jsonl(dataset_path)

    client = build_client()
    file_id = upload_file(client, dataset_path)
    job_id = create_job(client, file_id, args.base_model, args.suffix)

    if args.no_wait:
        print(f"\n[finetune] Задание запущено в фоне. Проверить статус позже:")
        print(f"    python3 finetune_openai.py --check {job_id}")
        print(f"job_id = {job_id}")
        return

    job = poll_job(client, job_id, args.poll_seconds)

    print("\n" + "=" * 60)
    if job.status == "succeeded":
        print(f"ГОТОВО! Fine-tuned модель обучена успешно.")
        print(f"model_id: {job.fine_tuned_model}")
        print(f"\nЧтобы использовать её в боте, впиши в backend/.env:")
        print(f"    OPENAI_MODEL={job.fine_tuned_model}")
        print(f"и перезапусти бота: pm2 restart all")
        if getattr(job, "trained_tokens", None):
            print(f"\nОбучено токенов: {job.trained_tokens}")
            print(
                f"Ориентировочная стоимость обучения (по цене ~$3.00 / 1M токенов для gpt-4o-mini): "
                f"${job.trained_tokens / 1_000_000 * 3.0:.2f} "
                f"(уточни актуальную цену на platform.openai.com/pricing)"
            )
    else:
        print(f"Задание завершилось со статусом: {job.status}")
        if getattr(job, "error", None):
            print(f"Ошибка: {job.error}")
    print("=" * 60)


if __name__ == "__main__":
    main()
