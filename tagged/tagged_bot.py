#!/usr/bin/env python3
"""
Tagged.com multi-account chat bot → soft invite to Telegram after ~3–4 minutes.

Flow per account:
  1) login to Tagged (Playwright) — session saved under tagged/sessions/
  2) open https://app.tagged.com/c and poll conversations
  3) reply with OpenAI using that account's persona
  4) after invite window, gently suggest THIS account's Telegram @username

Config:
  - tagged/accounts.json  OR  miniapp export tagged/accounts.from-db.json
  - env OPENAI_API_KEY (optional override)

Modes:
  default              dry-run (no browser)
  TAGGED_DEMO_INVITE=1 dry-run + sample AI invite reply
  TAGGED_LIVE=1        Playwright live loop
  TAGGED_PROBE=1       login + dump DOM/network helpers for selector calibration
  TAGGED_HEADLESS=0    show browser window
"""

from __future__ import annotations

import json
import logging
import os
import random
import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "accounts.json"
FROM_DB_PATH = ROOT / "accounts.from-db.json"
USE_FROM_DB_FLAG = ROOT / ".use-from-db"
STATE_PATH = ROOT / "state.json"
SESSIONS_DIR = ROOT / "sessions"
PROBE_DIR = ROOT / "probe"
DISCOVERED_APIS = ROOT / "discovered_apis.json"
_STATE_LOCK = threading.Lock()

LOGIN_URL = "https://app.tagged.com/get-started/email/login"
CHAT_URL_DEFAULT = "https://app.tagged.com/chats"


def normalize_chat_url(url: str | None) -> str:
    """Всегда /chats — /c редиректит и ломает возврат из диалога."""
    u = (url or CHAT_URL_DEFAULT).strip().rstrip("/")
    if not u:
        return CHAT_URL_DEFAULT
    if u.endswith("/c"):
        return u[:-2] + "/chats"
    if "/chats" not in u and "tagged.com" in u:
        return CHAT_URL_DEFAULT
    return u


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("tagged")

# ---------------------------------------------------------------------------
# Selectors (login verified 2026-09; chat selectors — refine via TAGGED_PROBE=1)
# ---------------------------------------------------------------------------
SEL_EMAIL = (
    'input[placeholder*="email" i], input[placeholder*="E-mail" i], '
    'input[type="email"], input[name="email"], input[autocomplete="email"], '
    'input[aria-label*="mail" i]'
)
SEL_PASSWORD = (
    'input[type="password"], input[name="password"], '
    'input[placeholder*="Password" i], input[autocomplete="current-password"]'
)
SEL_LOGIN_SUBMIT = (
    'button:has-text("Sign in"), button:has-text("Log in"), '
    'button[type="submit"]'
)
SEL_COOKIE_ACCEPT = (
    "#onetrust-accept-btn-handler, "
    "button:has-text('I Accept'), button:has-text('Accept All'), "
    "button:has-text('Allow All'), button:has-text('Reject All')"
)

# Chat — confirmed probe 2026-10-01 on /chats/{id}
# message-sent / message-received = LI groups (может быть несколько пузырей внутри)
# DOM newest-first (flex-col-reverse); composer = chat-message-input
SEL_CHAT_LIST = '[data-testid="conversation-list"]'
# Только li[data-testid=chat-item-N], без вложенных <a> — иначе дубли и «залипание» на первых 4
SEL_CHAT_ITEM = '[data-testid="conversation-list"] > [data-testid^="chat-item-"], [data-testid^="chat-item-"]'
SEL_CHAT_UNREAD = (
    '.text-wds-list-chat-icon-message-unread, '
    '.bg-wds-badge-dot-unread-bg, [class*="badge-dot-unread"]'
)
SEL_MESSAGE_RECEIVED = '[data-testid="message-received"]'
SEL_MESSAGE_SENT = '[data-testid="message-sent"]'
# Не используем широкий [data-testid*="message"] — цепляет chat-message-input
SEL_MESSAGE_BUBBLE = f"{SEL_MESSAGE_RECEIVED}, {SEL_MESSAGE_SENT}"
SEL_COMPOSER = (
    '[data-testid="chat-message-input"], '
    'textarea[name="message"], '
    'textarea[placeholder*="Your message" i]'
)
SEL_SEND = '[data-testid="send"], button[aria-label*="Send" i]'

INVITE_TEMPLATES_EN = [
    "hey this app is kinda laggy for me — you on telegram? mine is {tg}",
    "wanna continue on tg? easier to chat there — {tg}",
    "tagged notifications are weird on my phone, add me on telegram {tg} if you want",
    "i talk more on telegram tbh — {tg} if you're down",
]
INVITE_TEMPLATES_RU = [
    "тут неудобно переписываться, давай в телегу? у меня {tg}",
    "добавь в телеграм {tg} — тут глючит иногда",
    "удобнее в тг продолжить, я там {tg}",
]


@dataclass
class AccountCfg:
    id: str
    enabled: bool
    tagged_email: str
    tagged_password: str
    persona_name: str
    persona_prompt: str
    telegram_username: str
    telegram_display: str
    language: str = "en"
    # 3–4 минуты — как в админке/БД (не 5–6 из старого example)
    invite_after_min: int = 180
    invite_after_max: int = 240
    db_id: int | None = None
    dolphin_profile_id: str | None = None  # Dolphin Anty profile id
    telegram_account_id: int | None = None  # miniapp accounts.id for outreach


@dataclass
class DialogState:
    # 0 = диалог ещё не «начался» (нет ни одного user-сообщения) —
    # таймер инвайта не тикает вхолостую.
    started_at: float
    last_user_at: float
    invites_sent: int = 0
    last_invite_at: float = 0.0
    last_seen_hash: str = ""
    history: list[dict[str, Any]] = field(default_factory=list)
    peer_telegram: str = ""
    tg_outreach_done: bool = False
    tg_outreach_at: float = 0.0


# ---------------------------------------------------------------------------
# Config / state
# ---------------------------------------------------------------------------

def load_config() -> dict[str, Any]:
    prefer_db = USE_FROM_DB_FLAG.exists() or (
        FROM_DB_PATH.exists() and not CONFIG_PATH.exists()
    )
    path = FROM_DB_PATH if prefer_db and FROM_DB_PATH.exists() else CONFIG_PATH
    if not path.exists():
        example = ROOT / "accounts.example.json"
        raise SystemExit(
            f"Create {CONFIG_PATH.name} (copy {example.name}) "
            "or export from miniapp/bot «Сайты»."
        )
    log.info("config: %s", path.name)
    cfg = json.loads(path.read_text(encoding="utf-8"))

    # OPENAI: accounts.json → env → tagged/.env → ../backend/.env
    if not (cfg.get("openai_api_key") or "").strip():
        env_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
        if not env_key:
            for env_file in (ROOT / ".env", ROOT.parent / "backend" / ".env"):
                if not env_file.exists():
                    continue
                try:
                    for line in env_file.read_text(encoding="utf-8").splitlines():
                        line = line.strip()
                        if line.startswith("OPENAI_API_KEY="):
                            env_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                            break
                except Exception:
                    pass
                if env_key:
                    break
        if env_key:
            cfg["openai_api_key"] = env_key
            log.info("OpenAI key loaded from env/.env")
        else:
            log.warning("OpenAI key missing — replies will use templates")
    return cfg


def load_state() -> dict[str, Any]:
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"dialogs": {}}


def save_state(state: dict[str, Any]) -> None:
    with _STATE_LOCK:
        STATE_PATH.write_text(
            json.dumps(state, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def parse_accounts(cfg: dict[str, Any]) -> list[AccountCfg]:
    out: list[AccountCfg] = []
    invite_global = cfg.get("invite") or {}
    for row in cfg.get("accounts") or []:
        invite_min = int(
            row.get("invite_after_min")
            or invite_global.get("after_seconds_min")
            or 180
        )
        invite_max = int(
            row.get("invite_after_max")
            or invite_global.get("after_seconds_max")
            or 240
        )
        if invite_max < invite_min:
            invite_max = invite_min
        tg = str(row.get("telegram_username") or "").lstrip("@")
        tg_acc = row.get("telegram_account_id")
        out.append(
            AccountCfg(
                id=str(row["id"]),
                enabled=bool(row.get("enabled", True)),
                tagged_email=str(row.get("tagged_email") or row.get("login") or ""),
                tagged_password=str(
                    row.get("tagged_password") or row.get("password") or ""
                ),
                persona_name=str(row.get("persona_name") or row["id"]),
                persona_prompt=str(row.get("persona_prompt") or ""),
                telegram_username=tg,
                telegram_display=str(
                    row.get("telegram_display") or (f"@{tg}" if tg else "")
                ),
                language=str(row.get("language") or "en").lower(),
                invite_after_min=invite_min,
                invite_after_max=invite_max,
                db_id=int(row["db_id"]) if row.get("db_id") is not None else None,
                dolphin_profile_id=(
                    str(row["dolphin_profile_id"]).strip()
                    if row.get("dolphin_profile_id")
                    else None
                ),
                telegram_account_id=(
                    int(tg_acc) if tg_acc not in (None, "", 0, "0") else None
                ),
            )
        )
    return [a for a in out if a.enabled and a.tagged_email and a.telegram_username]


def dialog_key(account_id: str, peer_id: str) -> str:
    return f"{account_id}:{peer_id}"


def ensure_dialog(state: dict[str, Any], account_id: str, peer_id: str) -> DialogState:
    key = dialog_key(account_id, peer_id)
    raw = (state.get("dialogs") or {}).get(key) or {}
    now = time.time()
    # started_at=0 → таймер инвайта ещё не запущен (ждём первое user-сообщение)
    started_raw = raw.get("started_at")
    started_at = float(started_raw) if started_raw not in (None, "", 0, "0") else 0.0
    return DialogState(
        started_at=started_at,
        last_user_at=float(raw.get("last_user_at") or now),
        invites_sent=int(raw.get("invites_sent") or 0),
        last_invite_at=float(raw.get("last_invite_at") or 0),
        last_seen_hash=str(raw.get("last_seen_hash") or ""),
        history=list(raw.get("history") or []),
        peer_telegram=str(raw.get("peer_telegram") or "").lstrip("@"),
        tg_outreach_done=bool(raw.get("tg_outreach_done")),
        tg_outreach_at=float(raw.get("tg_outreach_at") or 0),
    )


def persist_dialog(
    state: dict[str, Any],
    account_id: str,
    peer_id: str,
    ds: DialogState,
) -> None:
    with _STATE_LOCK:
        state.setdefault("dialogs", {})[dialog_key(account_id, peer_id)] = {
            "started_at": ds.started_at,
            "last_user_at": ds.last_user_at,
            "invites_sent": ds.invites_sent,
            "last_invite_at": ds.last_invite_at,
            "last_seen_hash": ds.last_seen_hash,
            "history": ds.history[-30:],
            "peer_telegram": ds.peer_telegram,
            "tg_outreach_done": ds.tg_outreach_done,
            "tg_outreach_at": ds.tg_outreach_at,
        }


_TG_HINT_RE = re.compile(
    r"(?:telegram|telegrm|\btg\b|t\.me/|телеграм|телега|тг\b)",
    re.I,
)
_HANDLE_RE = re.compile(r"(?<!\w)@([A-Za-z][A-Za-z0-9_]{4,31})")


def extract_peer_telegram(
    history: list[dict[str, Any]],
    our_username: str = "",
) -> str | None:
    """Достаёт его @ / t.me из входящих. Не путаем с нашим хэндлом."""
    ours = (our_username or "").lower().lstrip("@")
    for m in reversed(history or []):
        if m.get("role") != "user":
            continue
        text = str(m.get("content") or "")
        found: str | None = None
        m_link = re.search(r"(?:t\.me|telegram\.me)/([A-Za-z][A-Za-z0-9_]{4,31})", text, re.I)
        if m_link:
            found = m_link.group(1)
        if not found:
            m_at = _HANDLE_RE.search(text)
            if m_at:
                found = m_at.group(1)
        if not found:
            m_plain = re.search(
                r"(?:telegram|telegrm|\btg\b|телеграм|телега|\bтг\b)\s*(?:is|:|—|-)?\s*@?([A-Za-z][A-Za-z0-9_]{4,31})",
                text,
                re.I,
            )
            if m_plain and _TG_HINT_RE.search(text):
                found = m_plain.group(1)
        if not found:
            continue
        if ours and found.lower() == ours:
            continue
        if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{4,31}", found):
            return found
    return None


def history_already_has_our_invite(ds: DialogState, account: AccountCfg | None) -> bool:
    """True if we already dropped our Telegram @ in this dialog."""
    if not account or not account.telegram_username:
        return False
    needle = account.telegram_username.lower().lstrip("@")
    for m in ds.history:
        if m.get("role") != "assistant":
            continue
        text = _norm(str(m.get("content") or "")).replace("@", "")
        if needle and needle in text:
            return True
        if _TG_HINT_RE.search(text) and (
            "add me" in text or "mine is" in text or "у меня" in text
        ):
            return True
    return False


def peer_already_shared_telegram(ds: DialogState, account: AccountCfg | None = None) -> bool:
    if ds.peer_telegram:
        return True
    ours = account.telegram_username if account else ""
    return bool(extract_peer_telegram(ds.history, ours))


def load_backend_settings(cfg: dict[str, Any]) -> tuple[str, str]:
    """(backend_url, worker_secret) из cfg / env / tagged/.env."""
    url = (
        os.environ.get("BACKEND_URL")
        or cfg.get("backend_url")
        or ""
    ).strip().rstrip("/")
    secret = (
        os.environ.get("DATING_WORKER_SECRET")
        or cfg.get("dating_worker_secret")
        or ""
    ).strip()
    if not url or not secret:
        for env_file in (ROOT / ".env", ROOT.parent / "backend" / ".env"):
            if not env_file.exists():
                continue
            try:
                for line in env_file.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    v = v.strip().strip('"').strip("'")
                    if not url and k.strip() in ("BACKEND_URL", "API_URL"):
                        url = v.rstrip("/")
                    if not secret and k.strip() == "DATING_WORKER_SECRET":
                        secret = v
            except Exception:
                pass
    return url, secret


def request_tg_outreach(
    cfg: dict[str, Any],
    account: AccountCfg,
    peer_username: str,
) -> dict[str, Any]:
    """Пишет ему первыми с TG-аккаунта девушки через miniapp API (с retry)."""
    import urllib.error
    import urllib.request

    url, secret = load_backend_settings(cfg)
    if not url or not secret:
        return {
            "ok": False,
            "error": "backend_url / DATING_WORKER_SECRET не заданы",
            "code": "no_backend",
        }

    payload = {
        "peer_username": peer_username.lstrip("@"),
        "girl_username": account.telegram_username,
        "persona_name": account.persona_name,
        "language": account.language,
    }
    if account.telegram_account_id:
        payload["telegram_account_id"] = account.telegram_account_id

    data = json.dumps(payload).encode("utf-8")
    last: dict[str, Any] = {"ok": False, "error": "unknown"}
    for attempt in range(1, 4):
        req = urllib.request.Request(
            f"{url}/api/dating-sites/outreach",
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Dating-Worker-Secret": secret,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                body = json.loads(resp.read().decode("utf-8", errors="replace"))
                return body if isinstance(body, dict) else {"ok": False, "error": "bad_json"}
        except urllib.error.HTTPError as e:
            try:
                detail = json.loads(e.read().decode("utf-8", errors="replace"))
            except Exception:
                detail = {"error": str(e)}
            last = {
                "ok": False,
                "success": False,
                "error": detail.get("error") or str(e),
                "code": detail.get("code"),
                "status": e.code,
            }
            # 4xx (кроме 408/429) — нет смысла ретраить
            if e.code in (408, 429) or e.code >= 500:
                time.sleep(1.5 * attempt)
                continue
            return last
        except Exception as e:
            last = {"ok": False, "success": False, "error": str(e), "code": "network"}
            time.sleep(1.5 * attempt)
    return last


OUTREACH_PERMANENT_CODES = frozenset(
    {"peer_not_found", "bad_peer", "self", "send_forbidden", "girl_mismatch"}
)


def outreach_ack_reply(account: AccountCfg, peer_username: str, ok: bool) -> str:
    ru = account.language.startswith("ru")
    if ok:
        if ru:
            return random.choice(
                [
                    f"ок нашла @{peer_username}, написала тебе в тг",
                    "ага, кинула тебе в телегу",
                    f"написала на @{peer_username} — глянь тг",
                ]
            )
        return random.choice(
            [
                f"ok found @{peer_username}, just texted you on tg",
                "wrote you on telegram — check there",
                f"messaged @{peer_username} on tg, peek when you can",
            ]
        )
    if ru:
        return random.choice(
            [
                "не вижу тебя в тг по этому нику — проверь написание?",
                "хм не нашла такой юзернейм, точно так?",
            ]
        )
    return random.choice(
        [
            "hmm can't find that username on tg — typo maybe?",
            "couldn't find you with that handle, double-check?",
        ]
    )


def should_invite(
    ds: DialogState,
    invite_cfg: dict[str, Any],
    account: AccountCfg | None = None,
) -> bool:
    if account is not None:
        after_min = int(account.invite_after_min)
        after_max = int(account.invite_after_max)
    else:
        after_min = int(invite_cfg.get("after_seconds_min", 180))
        after_max = int(invite_cfg.get("after_seconds_max", 240))
    if after_max < after_min:
        after_max = after_min
    # Таймер ещё не стартовал — рано
    if not ds.started_at or ds.started_at <= 0:
        return False
    target = after_min + (
        hash(str(ds.started_at)) % max(1, after_max - after_min + 1)
    )
    max_invites = int(invite_cfg.get("max_invites_per_dialog", 1))
    cooldown = int(invite_cfg.get("cooldown_seconds", 120))
    now = time.time()

    # Already invited / he shared TG / we already DMed him first
    if ds.invites_sent >= max_invites or ds.tg_outreach_done:
        return False
    if history_already_has_our_invite(ds, account):
        if ds.invites_sent < 1:
            ds.invites_sent = max(ds.invites_sent, 1)
        return False
    if peer_already_shared_telegram(ds, account):
        return False

    if now - ds.started_at < target:
        return False
    if ds.last_invite_at and now - ds.last_invite_at < cooldown:
        return False
    user_msgs = sum(1 for m in ds.history if m.get("role") == "user")
    return user_msgs >= 2


def pick_invite(account: AccountCfg) -> str:
    bank = (
        INVITE_TEMPLATES_RU
        if account.language.startswith("ru")
        else INVITE_TEMPLATES_EN
    )
    return random.choice(bank).format(tg=account.telegram_display)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def merge_history(
    stored: list[dict[str, Any]],
    live: list[dict[str, str]],
) -> list[dict[str, str]]:
    """
    Склеивает историю из state + DOM.
    Свои прошлые ответы из state помечают совпадающие DOM-пузыри как assistant.
    """
    own = {
        _norm(m.get("content", ""))
        for m in stored
        if m.get("role") == "assistant" and m.get("content")
    }
    out: list[dict[str, str]] = []
    for m in live:
        content = clean_bubble_text(str(m.get("content") or ""))
        if not content:
            continue
        role = m.get("role") or "user"
        if _norm(content) in own:
            role = "assistant"
        # не дублируем подряд одинаковое
        if out and _norm(out[-1]["content"]) == _norm(content) and out[-1]["role"] == role:
            continue
        out.append({"role": role, "content": content})

    # если DOM бедный — дополняем из stored
    if len(out) < 2 and stored:
        for m in stored[-12:]:
            role = m.get("role")
            content = str(m.get("content") or "").strip()
            if role not in ("user", "assistant") or not content:
                continue
            if out and _norm(out[-1]["content"]) == _norm(content):
                continue
            out.append({"role": role, "content": content})
    return out[-20:]


def recent_assistant_lines(history: list[dict[str, Any]], n: int = 5) -> list[str]:
    lines = [
        str(m.get("content") or "").strip()
        for m in history
        if m.get("role") == "assistant" and m.get("content")
    ]
    return lines[-n:]


def looks_like_repeat(candidate: str, previous: list[str]) -> bool:
    c = _norm(candidate)
    if not c:
        return True
    for prev in previous:
        p = _norm(prev)
        if not p:
            continue
        if c == p:
            return True
        # почти тот же привет / вопрос про day
        if len(c) > 12 and (c in p or p in c):
            return True
        # оба про "how's your day" / "what's up"
        greet_bits = ("how is your day", "how's your day", "hows your day", "what's up", "whats up", "hey there")
        if any(b in c for b in greet_bits) and any(b in p for b in greet_bits):
            return True
    return False


def build_system_prompt(account: AccountCfg, invite_now: bool, history: list[dict[str, Any]]) -> str:
    ru = account.language.startswith("ru")
    prev = recent_assistant_lines(history, 4)
    prev_block = ""
    if prev:
        label = "Твои недавние сообщения (НЕ повторяй и не перефразируй):" if ru else "Your recent messages (DO NOT repeat or paraphrase):"
        prev_block = f"\n{label}\n- " + "\n- ".join(f"«{x[:120]}»" for x in prev)

    persona = (account.persona_prompt or "").strip()
    if ru:
        persona = persona or "Тёплая, лёгкая, чуть игривая, без давления."
        base = (
            f"Ты {account.persona_name} — живая девушка в чате сайта знакомств Tagged. "
            f"Вы только начали переписку, вы не пара и не старые друзья.\n"
            f"Характер: {persona}\n\n"
            "КАК ПИСАТЬ (как в мессенджере с телефона):\n"
            "- Обычно 1 короткая фраза (3–12 слов), максимум 2. Без абзацев и списков.\n"
            "- Сначала ответь на смысл ЕГО последнего сообщения — не начинай чат заново.\n"
            "- Не здоровайся снова, если уже поздоровались.\n"
            "- Не спрашивай снова «как день / что делаешь / how's it going», если уже спрашивала.\n"
            "- Вопрос в конце — редко (примерно каждый 5-й ответ). Не допрос.\n"
            "- Иногда сама кинь мелочь из «жизни» (кофе, сериал, устала, скучно на Tagged) — "
            "но не одну и ту же.\n"
            "- Можно лёгкий подкол / ирония / «ахах» к месту. Не восторгайся каждым его словом.\n"
            "- На комплимент не шаблон «спасибо приятно» — живее: «ой всё», «засмущал», «ну знаю» и т.п.\n"
            "- Эмодзи почти никогда. Скобку «)» можно редко, не в каждом сообщении.\n"
            "- О себе всегда в женском роде.\n"
            "- Не признавайся что ты бот/ИИ. Не звучи как колл-центр или анкета.\n"
            "- ЗАПРЕЩЕНО: эссе, мораль, списки, «приятно общаться», «всегда рада», "
            "«уверенность помогает», зеркальное «а ты?» после каждого ответа про себя.\n"
            "- Не выдумывай другой Telegram / телефон / инсту.\n"
            f"{prev_block}"
        )
    else:
        persona = persona or "Warm, light, a bit playful, not clingy."
        base = (
            f"You are {account.persona_name} — a real girl chatting on the Tagged dating site. "
            f"You two just started talking; you're not a couple and not old friends.\n"
            f"Personality: {persona}\n\n"
            "HOW TO TEXT (like on your phone in a dating chat):\n"
            "- Usually 1 short line (3–12 words), max 2. No paragraphs, no bullet lists.\n"
            "- FIRST answer what HE just said — never restart with a fresh hello.\n"
            "- If you already greeted, don't greet again.\n"
            "- Do NOT re-ask 'how's your day' / 'what's up' / 'what are you up to' if you already did.\n"
            "- End with a question rarely (~every 5th reply). No interrogation.\n"
            "- Sometimes share a tiny life crumb (coffee, a show, bored on Tagged, just got home) — "
            "don't reuse the same crumb.\n"
            "- Light tease / irony / 'haha' when it fits. Don't hype every line he sends "
            "('cool'/'nice'/'interesting' spam = no).\n"
            "- On compliments skip the 'thanks that's sweet' template — be human "
            "('stopp', 'lol you', 'I know', 'okay flattery works').\n"
            "- Almost never use emoji. No Russian words. Avoid the ')' smiley (sounds Slavic).\n"
            "- Never admit you're a bot/AI. Don't sound like customer support or a dating bio.\n"
            "- FORBIDDEN: essays, morals, lists, 'nice chatting with you', 'always happy to talk', "
            "mirroring 'and you?' after every answer about yourself.\n"
            "- Do not invent a different Telegram / phone / Instagram.\n"
            f"{prev_block}"
        )

    if invite_now:
        if ru:
            base += (
                f"\nСейчас мягко предложи продолжить в Telegram и укажи ТОЛЬКО {account.telegram_display}. "
                "Одной естественной фразой, без рекламы и без давления."
            )
        else:
            base += (
                f"\nNow softly suggest continuing on Telegram and mention ONLY {account.telegram_display}. "
                "One natural line — casual, not salesy."
            )
    else:
        if ru:
            base += "\nПока не кидай телефон / инсту / телегу — просто общайся тут на Tagged."
        else:
            base += "\nDo NOT share phone / Instagram / Telegram yet — just chat here on Tagged."
    return base


def fallback_reply(account: AccountCfg, user_text: str, history: list[dict[str, Any]], invite_now: bool) -> str:
    if invite_now:
        return pick_invite(account)
    prev = recent_assistant_lines(history, 3)
    ru = account.language.startswith("ru")
    u = _norm(user_text)
    options_en = [
        "haha fair — what are you usually up to on here?",
        "nice, I'm just killing time tbh",
        "lol okay — tell me something random about you",
        "mm same vibe. you from around here?",
        "oh word. what made you message me tho",
    ]
    options_ru = [
        "ахах поняла — а ты обычно зачем тут сидишь?",
        "норм, я просто от скуки",
        "ок расскажи что-нибудь рандомное про себя",
        "мм то же самое. ты откуда?",
        "ясно. а чего написал кстати",
    ]
    if any(x in u for x in ("fun", "chat", "here", "скук", "общ", "тут")):
        options_en = [
            "same honestly — easier than swiping forever",
            "ha yeah chatting is the whole point",
            "fair. so what are you like irl then",
        ]
        options_ru = [
            "та же тема — листать уже надоело",
            "ну да ради общения же",
            "ок а ты какой в жизни",
        ]
    bank = options_ru if ru else options_en
    random.shuffle(bank)
    for cand in bank:
        if not looks_like_repeat(cand, prev):
            return cand
    return bank[0]


def generate_ai_reply(
    cfg: dict[str, Any],
    account: AccountCfg,
    history: list[dict[str, Any]],
    user_text: str,
    invite_now: bool,
) -> str:
    api_key = (cfg.get("openai_api_key") or "").strip()
    hist = [m for m in history if m.get("role") in ("user", "assistant") and m.get("content")]
    prev = recent_assistant_lines(hist, 5)

    if not api_key:
        return fallback_reply(account, user_text, hist, invite_now)

    try:
        from openai import OpenAI
    except ImportError:
        log.warning("package 'openai' not installed — template reply (pip install openai)")
        return fallback_reply(account, user_text, hist, invite_now)

    client_kwargs: dict[str, Any] = {"api_key": api_key}
    if cfg.get("openai_base_url"):
        client_kwargs["base_url"] = cfg["openai_base_url"]
    client = OpenAI(**client_kwargs)

    messages: list[dict[str, str]] = [
        {"role": "system", "content": build_system_prompt(account, invite_now, hist)}
    ]
    for row in hist[-14:]:
        messages.append({"role": row["role"], "content": str(row["content"]).strip()[:500]})
    # якорь на последнее сообщение собеседника
    messages.append(
        {
            "role": "user",
            "content": (
                f"His latest message: «{user_text.strip()[:400]}»\n"
                "Reply as a real girl on Tagged — short, natural, to THAT message only. "
                "Do not reuse your earlier lines."
            ),
        }
    )

    model = cfg.get("openai_model") or "gpt-4o-mini"
    text = ""
    for attempt in range(2):
        completion = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.9 if attempt == 0 else 1.05,
            max_tokens=90,
        )
        text = (completion.choices[0].message.content or "").strip()
        text = text.strip().strip('"').strip("'").strip("`")
        if looks_like_repeat(text, prev):
            messages.append(
                {
                    "role": "system",
                    "content": "That reply repeats yourself. Write a DIFFERENT short reply to his last message.",
                }
            )
            continue
        break
    else:
        text = fallback_reply(account, user_text, hist, invite_now)

    if invite_now and account.telegram_username.lower() not in text.lower().replace("@", ""):
        text = f"{text} {pick_invite(account)}".strip()

    # EN: убрать русские хвосты и )-смайлы
    if not account.language.startswith("ru"):
        text = re.sub(r"[)）]{1,3}\s*$", "", text).strip()
        if re.search(r"[А-Яа-яЁё]", text):
            text = fallback_reply(account, user_text, hist, invite_now)

    return text[:300]


# ---------------------------------------------------------------------------
# Browser helpers
# ---------------------------------------------------------------------------

def session_path(account: AccountCfg) -> Path:
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^\w.-]+", "_", account.id)
    return SESSIONS_DIR / f"{safe}.json"


def dismiss_cookies(page) -> None:
    try:
        loc = page.locator(SEL_COOKIE_ACCEPT).first
        if loc.count() and loc.is_visible(timeout=1500):
            loc.click(timeout=2000)
            page.wait_for_timeout(800)
            log.info("cookie banner dismissed")
    except Exception:
        # OneTrust often in iframe — try frame walk
        try:
            for frame in page.frames:
                btn = frame.locator(
                    "#onetrust-accept-btn-handler, button:has-text('I Accept'), "
                    "button:has-text('Reject All'), button:has-text('Allow All')"
                ).first
                if btn.count():
                    btn.click(timeout=2000)
                    page.wait_for_timeout(500)
                    log.info("cookie banner dismissed (iframe)")
                    return
        except Exception:
            pass


def looks_logged_in(page) -> bool:
    url = (page.url or "").lower()
    if any(x in url for x in ("/c", "/home", "/browse", "/meet", "/profile")):
        if "get-started" not in url and "login" not in url:
            return True
    try:
        if page.locator(SEL_COMPOSER).count() > 0:
            return True
        if page.locator(SEL_CHAT_ITEM).count() > 0:
            return True
    except Exception:
        pass
    return False


def login_tagged(page, account: AccountCfg, chat_url: str) -> None:
    page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=90000)
    page.wait_for_timeout(1500)
    dismiss_cookies(page)

    if looks_logged_in(page):
        log.info("[%s] already logged in (session)", account.id)
    else:
        # Ensure email login form
        if "email/login" not in page.url:
            try:
                page.locator('a:has-text("E-mail"), a:has-text("Email")').first.click(
                    timeout=3000
                )
                page.wait_for_timeout(1000)
            except Exception:
                page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(1000)
            dismiss_cookies(page)

        email = page.locator(SEL_EMAIL).first
        password = page.locator(SEL_PASSWORD).first
        email.wait_for(state="visible", timeout=20000)
        email.fill(account.tagged_email)
        password.fill(account.tagged_password)
        page.wait_for_timeout(400)

        submit = page.locator(SEL_LOGIN_SUBMIT).first
        try:
            if submit.is_disabled():
                page.evaluate(
                    """() => {
                      const b = [...document.querySelectorAll('button')]
                        .find(x => /sign in|log in/i.test(x.textContent||''));
                      if (b) b.disabled = false;
                    }"""
                )
            submit.click(timeout=5000)
        except Exception:
            password.press("Enter")

        page.wait_for_timeout(5000)
        dismiss_cookies(page)

        if "get-started" in page.url.lower() and "login" in page.url.lower():
            body = ""
            try:
                body = page.inner_text("body")[:300]
            except Exception:
                pass
            raise RuntimeError(
                f"Login failed for {account.tagged_email}. Still on {page.url}. "
                f"Page hint: {body!r}"
            )

    # После логина Tagged часто кидает в ленту лайков — принудительно в чаты /c
    go_to_chats(page, chat_url)
    log.info("[%s] opened chat %s", account.id, page.url)


def go_to_chats(page, chat_url: str) -> None:
    """Navigate to messages even if Tagged landed on likes/feed."""
    targets = [
        chat_url,
        "https://app.tagged.com/chats",
        "https://app.tagged.com/c",
        "https://app.tagged.com/chat",
        "https://app.tagged.com/messages",
    ]
    for url in targets:
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(2000)
            dismiss_cookies(page)
            if _looks_like_feed(page):
                for sel in (
                    'a[href="/chats"]',
                    'a[href*="/chats"]',
                    'a[href="/c"]',
                    'a[href*="/c"]',
                    'a:has-text("Chats")',
                    '[aria-label*="Chat" i]',
                    '[aria-label*="Message" i]',
                ):
                    try:
                        loc = page.locator(sel).first
                        if loc.count() and loc.is_visible(timeout=800):
                            loc.click(timeout=2000)
                            page.wait_for_timeout(1500)
                            break
                    except Exception:
                        continue
            if not _looks_like_feed(page):
                return
        except Exception as err:
            log.warning("go_to_chats %s: %s", url, err)
    log.warning("still not clearly on chat page: %s", page.url)


def _looks_like_feed(page) -> bool:
    url = (page.url or "").lower()
    if "/chats" in url or "/chat" in url or "/message" in url:
        # /c alone is ok too but /discover is feed
        if "/discover" in url:
            return True
        return False
    if any(x in url for x in ("/like", "/feed", "/browse", "/meet", "/discover", "/nearby")):
        return True
    return False


def remember_api(url: str, method: str = "GET") -> None:
    if not any(
        k in url.lower()
        for k in ("chat", "message", "conversation", "inbox", "thread", "im/")
    ):
        return
    data: dict[str, Any] = {"urls": []}
    if DISCOVERED_APIS.exists():
        try:
            data = json.loads(DISCOVERED_APIS.read_text(encoding="utf-8"))
        except Exception:
            pass
    entry = f"{method} {url.split('?')[0]}"
    urls = data.setdefault("urls", [])
    if entry not in urls:
        urls.append(entry)
        urls[:] = urls[-80:]
        DISCOVERED_APIS.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        log.info("discovered API: %s", entry)


def attach_network_sniffer(page) -> None:
    def on_response(resp) -> None:
        try:
            remember_api(resp.url, resp.request.method)
        except Exception:
            pass

    page.on("response", on_response)


def dump_probe(page, account: AccountCfg) -> None:
    """
    Снимает скрин + HTML + JSON структуры DOM.
    Нужен, чтобы калибровать селекторы пузырей (особенно message-sent /
    Contact:/Me: хром) — без этого live читает мусор.
    """
    PROBE_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    base = PROBE_DIR / f"{account.id}_{stamp}"
    try:
        page.screenshot(path=str(base.with_suffix(".png")), full_page=True)
    except Exception as err:
        log.warning("probe screenshot: %s", err)
    try:
        html = page.content()
        base.with_suffix(".html").write_text(html, encoding="utf-8")
    except Exception as err:
        log.warning("probe html: %s", err)
    try:
        summary = page.evaluate(
            """() => {
              const pick = (sel, n=8) => [...document.querySelectorAll(sel)]
                .slice(0, n)
                .map(el => ({
                  tag: el.tagName,
                  testid: el.getAttribute('data-testid'),
                  id: el.id || null,
                  class: (el.className||'').toString().slice(0,160),
                  text: (el.innerText||'').trim().slice(0,120),
                  href: el.getAttribute && el.getAttribute('href'),
                }));
              const testids = [...document.querySelectorAll('[data-testid]')]
                .map(el => el.getAttribute('data-testid'))
                .filter(Boolean);
              const uniq = [...new Set(testids)].sort();
              return {
                url: location.href,
                title: document.title,
                dataTestIds: uniq.slice(0, 120),
                messageReceived: pick('[data-testid=\"message-received\"]', 12),
                messageSent: pick('[data-testid=\"message-sent\"]', 12),
                messageAny: pick('[data-testid*=\"message\" i]', 20),
                chatItems: pick('[data-testid^=\"chat-item-\"]', 10),
                composer: pick('[data-testid=\"chat-message-input\"], textarea', 5),
                send: pick('[data-testid=\"send\"], button[type=\"submit\"]', 5),
                textareas: pick('textarea'),
                contenteditables: pick('[contenteditable=\"true\"]'),
                listitems: pick('[role=\"listitem\"], li'),
                links: pick('a[href*=\"chats\"], a[href*=\"/c/\"]'),
                buttons: pick('button', 20),
              };
            }"""
        )
        base.with_suffix(".json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        # Короткая сводка в лог — сразу видно, есть ли message-sent
        tids = summary.get("dataTestIds") or []
        log.info(
            "[%s] probe → %s.* | testids=%s | recv=%s sent=%s items=%s",
            account.id,
            base.name,
            len(tids),
            len(summary.get("messageReceived") or []),
            len(summary.get("messageSent") or []),
            len(summary.get("chatItems") or []),
        )
        interesting = [
            t
            for t in tids
            if any(k in t.lower() for k in ("message", "chat", "send", "compos"))
        ]
        if interesting:
            log.info("[%s] chat-related testids: %s", account.id, ", ".join(interesting[:40]))
    except Exception as err:
        log.warning("probe json: %s", err)


def peer_id_from_item(item) -> str:
    try:
        href = item.get_attribute("href") or ""
        if not href:
            # li[data-testid=chat-item-N] → inner <a>
            link = item.locator("a[href^='/chats/']").first
            if link.count():
                href = link.get_attribute("href") or ""
        m = re.search(r"/(?:chats|c|chat|conversation)/([^/?#]+)", href)
        if m:
            return m.group(1)
    except Exception:
        pass
    try:
        text = (item.inner_text() or "").strip().split("\n")[0][:80]
        if text:
            return re.sub(r"\s+", "_", text.lower())[:64]
    except Exception:
        pass
    return f"peer_{int(time.time())}"


def list_item_preview(item) -> str:
    """Текст превью последнего сообщения из строки списка чатов."""
    try:
        raw = (item.inner_text() or "").strip()
        lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
        if not lines:
            return ""
        # обычно: имя, превью, иногда время — превью предпоследняя/последняя
        if len(lines) == 1:
            return lines[0][:200]
        # отбрасываем имя (первая строка) и короткое время
        candidates = lines[1:]
        for ln in reversed(candidates):
            if re.fullmatch(r"\d{1,2}:\d{2}|\d+[mh]|yesterday|today", ln, re.I):
                continue
            return ln[:200]
        return candidates[-1][:200]
    except Exception:
        return ""


def clean_bubble_text(text: str) -> str:
    """Убирает UI-префикс Contact:/Me: у одного куска."""
    t = (text or "").strip()
    if not t:
        return ""
    t = re.sub(
        r"^(?:Contact|Me|You|Them)\s*:\s*",
        "",
        t,
        flags=re.I,
    ).strip()
    return re.sub(r"\n{2,}", "\n", t).strip()


def expand_bubble_group(raw: str) -> list[str]:
    """
    Один LI может держать пачку пузырей:
      «Me:\\ninvite…\\nMe:\\nHey…» / «Contact:\\nOK\\nContact:\\nHello»
    Probe 2026-10-01: DOM newest-first (flex-col-reverse) → части тоже
    newest-first. Возвращаем тексты в том же порядке (newest→oldest);
    read_messages потом развернёт всю ленту.
    """
    t = (raw or "").strip()
    if not t:
        return []
    parts = re.split(r"\n(?=(?:Contact|Me|You|Them)\s*:)", t, flags=re.I)
    out: list[str] = []
    for part in parts:
        cleaned = clean_bubble_text(part)
        if cleaned:
            out.append(cleaned)
    return out


def read_messages(page) -> list[dict[str, str]]:
    """
    Читает пузыри Tagged.
    Селекторы подтверждены probe 2026-10-01:
      message-received / message-sent (LI), chat-message-input, send.
    Лента в DOM newest-first → отдаём oldest-first для AI/инвайта.
    """
    msgs: list[dict[str, str]] = []
    try:
        # JS: точнее, чем Playwright-цикл — и не цепляет composer
        raw = page.evaluate(
            """() => {
              const nodes = [...document.querySelectorAll(
                '[data-testid="message-received"], [data-testid="message-sent"]'
              )];
              return nodes.map(el => ({
                tid: (el.getAttribute('data-testid') || '').toLowerCase(),
                text: (el.innerText || '').trim(),
                cls: (el.className || '').toString(),
              }));
            }"""
        )
        if not isinstance(raw, list):
            raw = []
        for item in raw:
            tid = str(item.get("tid") or "")
            text = str(item.get("text") or "")
            if "sent" in tid and "received" not in tid:
                role = "assistant"
            elif "received" in tid:
                role = "user"
            else:
                cls = str(item.get("cls") or "").lower()
                role = (
                    "assistant"
                    if "items-end" in cls or "sent" in cls
                    else "user"
                )
            for piece in expand_bubble_group(text):
                msgs.append({"role": role, "content": piece})
        # newest-first → oldest-first
        msgs.reverse()
    except Exception as err:
        log.debug("read_messages: %s", err)
    return msgs


def _page_contains_our_text(page, text: str) -> bool:
    """Грубая проверка: наш текст появился на странице после отправки."""
    needle = normalize_msg(text)
    if len(needle) < 4:
        return False
    try:
        for m in read_messages(page):
            body = normalize_msg(m.get("content", ""))
            if needle[:50] in body or body[:50] in needle:
                return True
    except Exception:
        pass
    try:
        body = normalize_msg(page.locator("body").inner_text(timeout=2000) or "")
        return needle[:40] in body
    except Exception:
        return False


def send_message(page, text: str) -> bool:
    """
    Отправка + проверка доставки.
    Раньше всегда возвращали True после click — при silent fail дедуп
    «уже ответили» навсегда блокировал диалог.
    """
    try:
        box = page.locator(SEL_COMPOSER).first
        box.wait_for(state="visible", timeout=8000)
        box.click()
        box.fill("")
        box.fill(text)
        page.wait_for_timeout(400)
        clicked = False
        for sel in (
            'button:has([data-testid="send"])',
            '[data-testid="send"]',
            'button[type="submit"]',
            SEL_SEND,
        ):
            try:
                btn = page.locator(sel).first
                if btn.count():
                    btn.click(timeout=2500, force=True)
                    clicked = True
                    break
            except Exception:
                continue
        if not clicked:
            box.press("Enter")
        page.wait_for_timeout(1500)
        if _page_contains_our_text(page, text):
            return True
        # React иногда глотает fill — повтор через type
        log.warning("send_message: text not visible after click, retry type()")
        try:
            box.click()
            box.fill("")
            box.type(text, delay=25)
            page.wait_for_timeout(300)
            box.press("Enter")
            page.wait_for_timeout(1500)
        except Exception as err:
            log.warning("send_message retry failed: %s", err)
            return False
        ok = _page_contains_our_text(page, text)
        if not ok:
            log.warning("send_message: still not visible — treat as fail")
        return ok
    except Exception as err:
        log.warning("send_message failed: %s", err)
        return False


def normalize_msg(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())[:200]


def process_open_chat(
    cfg: dict[str, Any],
    account: AccountCfg,
    state: dict[str, Any],
    page,
    peer: str,
    list_preview: str = "",
) -> None:
    invite_cfg = cfg.get("invite") or {}
    live_msgs = read_messages(page)
    ds = ensure_dialog(state, account.id, peer)
    msgs = merge_history(ds.history, live_msgs)

    own = {
        normalize_msg(m.get("content", ""))
        for m in ds.history
        if m.get("role") == "assistant"
    }

    if not msgs:
        # Preview из списка — крайний fallback. Без открытых пузырей легко ответить
        # не на то сообщение; берём только если превью похоже на живую реплику.
        preview = normalize_msg(list_preview)
        preview_raw = clean_bubble_text(list_preview)
        if (
            not preview
            or len(preview) < 6
            or preview == normalize_msg(ds.last_seen_hash)
        ):
            log.info("[%s] skip %s: no bubbles", account.id, peer)
            return
        if any(preview == normalize_msg(x) for x in own):
            log.info("[%s] skip %s: preview is our own", account.id, peer)
            return
        last_user = preview_raw[:200]
        msgs = [{"role": "user", "content": last_user}]
        log.warning(
            "[%s] %s: answering from list preview (no bubbles) — check selectors",
            account.id,
            peer,
        )
    else:
        last_user = ""
        for m in reversed(msgs):
            if m.get("role") == "user":
                last_user = str(m.get("content") or "").strip()[:200]
                break
        if not last_user:
            log.info(
                "[%s] skip %s: last msgs are ours (%s)",
                account.id,
                peer,
                msgs[-1].get("content", "")[:40],
            )
            return

    if normalize_msg(last_user) == normalize_msg(ds.last_seen_hash):
        log.info("[%s] skip %s: already answered «%s»", account.id, peer, last_user[:40])
        return

    if msgs and msgs[-1].get("role") == "assistant" and list_preview:
        prev = list_preview.strip()[:200]
        if prev and normalize_msg(prev) != normalize_msg(msgs[-1].get("content", "")):
            if normalize_msg(prev) != normalize_msg(ds.last_seen_hash):
                last_user = prev
                msgs.append({"role": "user", "content": last_user})

    ds.history = msgs[-20:]
    ds.last_user_at = time.time()
    # Таймер инвайта стартует только после первого реального user-сообщения
    if not ds.started_at or ds.started_at <= 0:
        ds.started_at = time.time()
        log.info("[%s] invite timer started for %s", account.id, peer)
    # last_seen_hash ставим ТОЛЬКО после успешной отправки —
    # иначе при fail/crash диалог навсегда «уже отвечен».

    # Он скинул свой TG → ищем в Telegram и пишем первыми
    peer_tg = extract_peer_telegram(ds.history, account.telegram_username)
    if peer_tg and not ds.tg_outreach_done:
        ds.peer_telegram = peer_tg
        # Не долбим API каждые 12с при girl_offline / network
        if ds.tg_outreach_at and time.time() - ds.tg_outreach_at < 90:
            log.info(
                "[%s] outreach cooldown @%s (%.0fs)",
                account.id,
                peer_tg,
                90 - (time.time() - ds.tg_outreach_at),
            )
            persist_dialog(state, account.id, peer, ds)
            save_state(state)
            return

        result = request_tg_outreach(cfg, account, peer_tg)
        ok = bool(result.get("success") or result.get("ok")) or bool(
            result.get("skipped")
        )
        if result.get("skipped") or result.get("reason") == "already_wrote":
            ok = True
        code = str(result.get("code") or "")
        ds.tg_outreach_at = time.time()

        if ok:
            ds.tg_outreach_done = True
            log.info(
                "[%s] outreach→@%s ok skipped=%s",
                account.id,
                peer_tg,
                result.get("skipped"),
            )
        elif code in OUTREACH_PERMANENT_CODES:
            # Постоянная ошибка — один fail-ack и стоп, без спама
            ds.tg_outreach_done = True
            log.warning(
                "[%s] outreach→@%s permanent fail (%s): %s",
                account.id,
                peer_tg,
                code,
                result.get("error") or result,
            )
        else:
            # Transient: без ack на Tagged, попробуем снова через cooldown
            log.warning(
                "[%s] outreach→@%s temp fail (%s): %s — retry later",
                account.id,
                peer_tg,
                code or "?",
                result.get("error") or result,
            )
            persist_dialog(state, account.id, peer, ds)
            save_state(state)
            return

        reply = outreach_ack_reply(account, peer_tg, ok)
        time.sleep(random.uniform(1.2, 3.0))
        if send_message(page, reply):
            ds.last_seen_hash = last_user
            ds.history.append({"role": "assistant", "content": reply, "at": time.time()})
            persist_dialog(state, account.id, peer, ds)
            save_state(state)
        else:
            # ack не ушёл — снимем done только для transient? permanent оставляем
            if not ok:
                pass
            persist_dialog(state, account.id, peer, ds)
            save_state(state)
        return

    invite_now = should_invite(ds, invite_cfg, account)
    reply = generate_ai_reply(cfg, account, ds.history, last_user, invite_now)
    time.sleep(random.uniform(1.5, 4.0))
    if send_message(page, reply):
        ds.last_seen_hash = last_user
        ds.history.append({"role": "assistant", "content": reply, "at": time.time()})
        if invite_now:
            ds.invites_sent += 1
            ds.last_invite_at = time.time()
            log.info("[%s] invite→%s: %s", account.id, account.telegram_display, reply)
        else:
            log.info("[%s] reply→%s: %s", account.id, peer, reply[:120])
        persist_dialog(state, account.id, peer, ds)
        save_state(state)
    else:
        persist_dialog(state, account.id, peer, ds)
        save_state(state)
        log.warning("[%s] send failed for %s", account.id, peer)


# ---------------------------------------------------------------------------
# Dolphin Anty (local API → Playwright CDP)
# ---------------------------------------------------------------------------

def dolphin_api_base(cfg: dict[str, Any]) -> str:
    return (
        os.environ.get("DOLPHIN_API")
        or cfg.get("dolphin_api")
        or "http://127.0.0.1:3001"
    ).rstrip("/")


def dolphin_start_profile(cfg: dict[str, Any], profile_id: str) -> str:
    """
    Start Dolphin profile with automation=1, return CDP endpoint for Playwright.
    Requires Dolphin Anty running on this PC (Local API enabled).
    """
    import urllib.error
    import urllib.request

    base = dolphin_api_base(cfg)
    url = f"{base}/v1.0/browser_profiles/{profile_id}/start?automation=1"
    log.info("Dolphin start: %s", url)
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as err:
        raise SystemExit(
            f"Dolphin Anty API недоступен ({base}). "
            "Открой Dolphin на этом ПК и включи Local API. "
            f"Ошибка: {err}"
        ) from err

    data = json.loads(raw)
    if not data.get("success", True) and data.get("error"):
        raise RuntimeError(f"Dolphin start failed: {data}")

    automation = data.get("automation") or data.get("data", {}).get("automation") or {}
    ws = (
        automation.get("wsEndpoint")
        or automation.get("ws_endpoint")
        or data.get("wsEndpoint")
    )
    port = automation.get("port") or data.get("port")
    if ws:
        # Playwright connect_over_cdp accepts http://host:port or ws://...
        if ws.startswith("ws"):
            # Prefer http CDP root if port known
            if port:
                return f"http://127.0.0.1:{port}"
            return ws
        return ws
    if port:
        return f"http://127.0.0.1:{port}"
    raise RuntimeError(
        f"Dolphin не вернул wsEndpoint/port. Ответ: {raw[:500]}"
    )


def dolphin_stop_profile(cfg: dict[str, Any], profile_id: str) -> None:
    import urllib.request

    base = dolphin_api_base(cfg)
    url = f"{base}/v1.0/browser_profiles/{profile_id}/stop"
    try:
        req = urllib.request.Request(url, method="GET")
        urllib.request.urlopen(req, timeout=30).read()
        log.info("Dolphin profile %s stopped", profile_id)
    except Exception as err:
        log.warning("Dolphin stop: %s", err)


def live_loop(cfg: dict[str, Any], account: AccountCfg, state: dict[str, Any]) -> None:
    from playwright.sync_api import sync_playwright

    chat_url = normalize_chat_url(cfg.get("chat_url") or CHAT_URL_DEFAULT)
    headless = os.environ.get("TAGGED_HEADLESS", "1") != "0" and bool(
        cfg.get("headless", True)
    )
    probe = os.environ.get("TAGGED_PROBE") == "1"
    poll_sec = float(cfg.get("poll_seconds") or 12)
    sess = session_path(account)
    dolphin_id = (
        account.dolphin_profile_id
        or os.environ.get("DOLPHIN_PROFILE_ID")
        or cfg.get("dolphin_profile_id")
    )
    if dolphin_id:
        dolphin_id = str(dolphin_id).strip()

    proxy = (cfg.get("proxy") or os.environ.get("TAGGED_PROXY") or "").strip()
    stop_dolphin = False
    # Внешний цикл: при падении CDP/page — переподключаемся, а не умираем навсегда.
    recover_delay = 8.0

    while True:
        with sync_playwright() as p:
            browser = None
            context = None
            page = None
            drop_for_recover = False
            try:
                if dolphin_id:
                    cdp = dolphin_start_profile(cfg, dolphin_id)
                    stop_dolphin = os.environ.get("DOLPHIN_KEEP_OPEN") != "1"
                    log.info("[%s] connect Dolphin CDP %s", account.id, cdp)
                    browser = p.chromium.connect_over_cdp(cdp)
                    context = (
                        browser.contexts[0]
                        if browser.contexts
                        else browser.new_context()
                    )
                    page = context.pages[0] if context.pages else context.new_page()
                else:
                    launch_kwargs: dict[str, Any] = {"headless": headless}
                    if proxy:
                        launch_kwargs["proxy"] = {"server": proxy}
                    browser = p.chromium.launch(**launch_kwargs)
                    ctx_kwargs: dict[str, Any] = {
                        "viewport": {"width": 1280, "height": 900},
                        "locale": "en-US",
                        "user_agent": (
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                            "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
                        ),
                    }
                    if sess.exists():
                        ctx_kwargs["storage_state"] = str(sess)
                        log.info("[%s] loading session %s", account.id, sess.name)
                    context = browser.new_context(**ctx_kwargs)
                    page = context.new_page()

                attach_network_sniffer(page)
                login_tagged(page, account, chat_url)
                if not dolphin_id:
                    context.storage_state(path=str(sess))
                    log.info("[%s] session saved", account.id)

                if probe:
                    dump_probe(page, account)
                    try:
                        first = page.locator('[data-testid^="chat-item-"]').first
                        if first.count():
                            first.click(timeout=5000)
                            page.wait_for_timeout(2500)
                            dump_probe(page, account)
                            log.info("[%s] opened first chat → %s", account.id, page.url)
                        else:
                            log.warning("[%s] no chat-item-* found", account.id)
                    except Exception as err:
                        log.warning("open first chat: %s", err)

                    log.info("[%s] probe done — check tagged/probe/", account.id)
                    if os.environ.get("TAGGED_HEADLESS", "1") == "0" or os.environ.get(
                        "TAGGED_PROBE_PAUSE", "1"
                    ) == "1":
                        log.info("Окно открыто. Enter в PowerShell — закрыть браузер.")
                        try:
                            input()
                        except EOFError:
                            time.sleep(120)
                    return

                log.info(
                    "[%s] live loop (poll %.0fs) url=%s",
                    account.id,
                    poll_sec,
                    chat_url,
                )
                idle_rounds = 0
                while True:
                    try:
                        if page.is_closed():
                            raise RuntimeError("page closed")
                        if "get-started" in page.url.lower():
                            log.warning("[%s] logged out — re-login", account.id)
                            login_tagged(page, account, chat_url)
                            if not dolphin_id:
                                context.storage_state(path=str(sess))

                        items = page.locator(SEL_CHAT_ITEM)
                        count = items.count()
                        if count == 0:
                            idle_rounds += 1
                            if idle_rounds == 1 or idle_rounds % 10 == 0:
                                log.info(
                                    "[%s] no chat items yet. url=%s",
                                    account.id,
                                    page.url,
                                )
                            if idle_rounds == 3:
                                dump_probe(page, account)
                        else:
                            idle_rounds = 0
                            processed = 0
                            max_per_round = 8
                            while processed < min(count, max_per_round):
                                if page.is_closed():
                                    raise RuntimeError("page closed")
                                items = page.locator(SEL_CHAT_ITEM)
                                count = items.count()
                                if count == 0:
                                    break
                                pick = None
                                pick_peer = ""
                                pick_preview = ""
                                for i in range(count):
                                    it = items.nth(i)
                                    try:
                                        if it.locator(SEL_CHAT_UNREAD).count():
                                            pick = it
                                            pick_peer = peer_id_from_item(it)
                                            pick_preview = list_item_preview(it)
                                            break
                                    except Exception:
                                        continue
                                if pick is None:
                                    idx = processed % count
                                    pick = items.nth(idx)
                                    pick_peer = peer_id_from_item(pick)
                                    pick_preview = list_item_preview(pick)

                                log.info(
                                    "[%s] open chat %s preview=%r (%s/%s)",
                                    account.id,
                                    pick_peer,
                                    (pick_preview or "")[:40],
                                    processed + 1,
                                    count,
                                )
                                try:
                                    link = pick.locator("a[href^='/chats/']").first
                                    if link.count():
                                        link.click(timeout=3000)
                                    else:
                                        pick.click(timeout=3000)
                                    page.wait_for_timeout(1500)
                                except Exception as err:
                                    log.debug("click chat: %s", err)
                                    processed += 1
                                    continue

                                try:
                                    process_open_chat(
                                        cfg,
                                        account,
                                        state,
                                        page,
                                        pick_peer or "?",
                                        list_preview=pick_preview or "",
                                    )
                                except Exception:
                                    log.exception(
                                        "[%s] process chat %s", account.id, pick_peer
                                    )

                                try:
                                    page.goto(
                                        chat_url,
                                        wait_until="domcontentloaded",
                                        timeout=30000,
                                    )
                                    page.wait_for_timeout(900)
                                except Exception:
                                    pass
                                processed += 1

                    except RuntimeError as err:
                        if "page closed" in str(err).lower():
                            log.error(
                                "[%s] page/CDP gone — reconnect in %.0fs",
                                account.id,
                                recover_delay,
                            )
                            drop_for_recover = True
                            break
                        log.exception("[%s] loop runtime: %s", account.id, err)
                    except Exception:
                        log.exception("[%s] loop error", account.id)

                    if drop_for_recover:
                        break
                    time.sleep(poll_sec + random.uniform(0, 3))

            finally:
                if context and not dolphin_id:
                    try:
                        context.storage_state(path=str(sess))
                    except Exception:
                        pass
                if dolphin_id and stop_dolphin:
                    dolphin_stop_profile(cfg, dolphin_id)
                elif browser and not dolphin_id:
                    try:
                        if context:
                            context.close()
                    except Exception:
                        pass
                    try:
                        browser.close()
                    except Exception:
                        pass

        if probe:
            return
        log.warning(
            "[%s] recovering live session in %.0fs…", account.id, recover_delay
        )
        time.sleep(recover_delay)
        recover_delay = min(recover_delay * 1.5, 60.0)


def stub_poll_once(account: AccountCfg) -> None:
    log.info(
        "[%s] dry-run ready → TG %s | window %s–%ss",
        account.id,
        account.telegram_display,
        account.invite_after_min,
        account.invite_after_max,
    )


def run_account(cfg: dict[str, Any], account: AccountCfg, state: dict[str, Any]) -> None:
    # LIVE важнее PROBE: если оба выставлены в одной сессии PowerShell — работаем live
    live = os.environ.get("TAGGED_LIVE") == "1"
    probe = os.environ.get("TAGGED_PROBE") == "1" and not live
    if not live and not probe:
        stub_poll_once(account)
        if os.environ.get("TAGGED_DEMO_INVITE") == "1":
            peer = "demo_peer"
            ds = ensure_dialog(state, account.id, peer)
            ds.history.append({"role": "user", "content": "hey", "at": time.time()})
            ds.history.append(
                {"role": "user", "content": "how's your day?", "at": time.time()}
            )
            ds.started_at = time.time() - 200
            invite_now = should_invite(ds, cfg.get("invite") or {}, account)
            reply = generate_ai_reply(
                cfg, account, ds.history, "how's your day?", invite_now
            )
            log.info("[%s] demo reply (invite=%s): %s", account.id, invite_now, reply)
            persist_dialog(state, account.id, peer, ds)
            save_state(state)
        return

    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
    except ImportError as e:
        raise SystemExit(
            "pip install playwright && playwright install chromium"
        ) from e

    # PROBE только через env; live_loop сам смотрит TAGGED_PROBE
    if live:
        os.environ["TAGGED_PROBE"] = "0"
    live_loop(cfg, account, state)


def main() -> None:
    cfg = load_config()
    accounts = parse_accounts(cfg)
    if not accounts:
        raise SystemExit(
            "No enabled accounts with email + telegram_username. "
            "Add via /menu → Сайты or accounts.json, then export."
        )
    state = load_state()
    live = os.environ.get("TAGGED_LIVE") == "1"
    probe = os.environ.get("TAGGED_PROBE") == "1" and not live
    mode = "LIVE" if live else ("PROBE" if probe else "DRY")
    log.info("Tagged bot [%s]: %s account(s)", mode, len(accounts))

    # LIVE: каждый Tagged-аккаунт = свой браузер + свой TG outreach (параллельно)
    if live and len(accounts) > 1:
        threads: list[threading.Thread] = []
        for acc in accounts:
            t = threading.Thread(
                target=_run_account_safe,
                args=(cfg, acc, state),
                name=f"tagged-{acc.id}",
                daemon=True,
            )
            threads.append(t)
            t.start()
            log.info("[%s] worker thread started → TG @%s (account_id=%s)",
                     acc.id, acc.telegram_username, acc.telegram_account_id)
        for t in threads:
            t.join()
        save_state(state)
        return

    for acc in accounts:
        try:
            run_account(cfg, acc, state)
        except Exception:
            log.exception("[%s] failed", acc.id)
    save_state(state)
    if mode == "DRY":
        log.info(
            "Next: add account → export → "
            "TAGGED_PROBE=1 TAGGED_HEADLESS=0 python tagged/tagged_bot.py"
        )


def _run_account_safe(
    cfg: dict[str, Any], account: AccountCfg, state: dict[str, Any]
) -> None:
    try:
        run_account(cfg, account, state)
    except Exception:
        log.exception("[%s] failed", account.id)


if __name__ == "__main__":
    main()
