# Tagged → Telegram handoff bot

Несколько профилей **Tagged** пишут на https://app.tagged.com/c.  
У каждого профиля — **свой Telegram**. Через ~3–4 минуты бот мягко зовёт туда.

## Логин (актуально 2026)

Email-форма: https://app.tagged.com/get-started/email/login  
(не старый `/login` — редиректит на get-started).

## Dolphin Anty (рекомендуется)

Команды **не** пишутся внутрь Dolphin. Пишутся в **PowerShell / CMD на Windows**
в папке проекта. Dolphin должен быть **запущен** на этом же ПК (Local API).

1. В Dolphin создай профиль → один раз зайди на Tagged вручную (или бот залогинит).
2. Скопируй **Profile ID** (в карточке профиля / URL).
3. В `accounts.json` у аккаунта укажи `"dolphin_profile_id": "123456"`  
   (или env `DOLPHIN_PROFILE_ID=123456`).
4. В PowerShell:

```powershell
cd C:\Users\lox\Desktop\tg-fallonWorkyByLove-main\tagged
pip install -r requirements.txt
playwright install chromium

$env:TAGGED_PROBE="1"
$env:DOLPHIN_KEEP_OPEN="1"   # не гасить профиль после probe
python .\tagged_bot.py
```

Бот сам стартует профиль через `http://127.0.0.1:3001` и цепляется Playwright’ом
к отпечатку Dolphin (не к «голому» Chromium).

Если Local API на другом порту: `$env:DOLPHIN_API="http://127.0.0.1:PORT"`

## Без Dolphin (обычный Playwright)

```powershell
cd C:\Users\lox\Desktop\tg-fallonWorkyByLove-main\tagged
$env:TAGGED_PROBE="1"
$env:TAGGED_HEADLESS="0"
python .\tagged_bot.py
```

Tagged чаще режет голый Chromium — для боя лучше Dolphin.

## Режимы

| env | что делает |
|-----|------------|
| _(пусто)_ | dry-run, без браузера |
| `TAGGED_DEMO_INVITE=1` | dry-run + пример инвайт-ответа (OpenAI/шаблон) |
| `TAGGED_PROBE=1` | логин + скрин/HTML/JSON DOM в `tagged/probe/` + лог API в `discovered_apis.json` |
| `TAGGED_LIVE=1` | бесконечный цикл: список чатов → ответ → инвайт по таймеру |
| `TAGGED_HEADLESS=0` | показать окно Chromium |
| `OPENAI_API_KEY` | ключ, если не в `accounts.json` |
| `TAGGED_PROXY` | опционально `socks5://user:pass@host:port` |

Сессии сохраняются в `tagged/sessions/<id>.json` — повторный логин не нужен, пока живы cookies.

## Инвайт / outreach

- Окно инвайта нашего `@`: ~3–4 мин (180–240 с), макс 1 раз / диалог
  (как в админке miniapp; таймер стартует только после первого его сообщения)
- Если **он** скинул свой `@` / `t.me/...` — инвайт наш **не** шлём; вместо этого
  воркер зовёт `POST /api/dating-sites/outreach` → MTProto-аккаунт девушки
  ищет его по username и пишет первым («hey it's Vikusha from Tagged…»)
- Нужны на сервере: `DATING_WORKER_SECRET` в `.env` бэкенда (тот же, что в `tagged/.env`)
  и живая сессия TG-аккаунта девушки (`@kirrqwert` онлайн в miniapp)
- Опционально `telegram_account_id` в `accounts.json` (= `accounts.id` в БД);
  иначе сервер матчит по `getMe().username`

## Что ещё калибровать

После первого `TAGGED_PROBE=1` с живым аккаунтом смотри `tagged/probe/*.json`:
- элементы списка диалогов
- пузыри сообщений / кто «свой»
- поле ввода и Send

Допили селекторы `SEL_CHAT_ITEM` / `SEL_MESSAGE_BUBBLE` / `SEL_COMPOSER` в `tagged_bot.py`.
Network-сниффер пишет похожие на chat URL в `discovered_apis.json` — если найдётся внутренний API, можно уйти с DOM на него.
