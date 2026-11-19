# Mac → VPS: выкат LoveRussian

Сервер: `root@loverussian.duckdns.org`  
Путь: `/root/opt/tgbot/tg-miniapp-loverussian`  
PM2: `tgbot`

## 1. Один раз на Mac

```bash
git fetch && git checkout cursor/miniapp-nav-accounts-quote-fixes && git pull
bash scripts/install-ssh-mac.sh
```

Должно напечатать `SSH_OK`.

Проверка:

```bash
ssh loverussian 'pm2 status tgbot; curl -sS http://127.0.0.1:3000/api/health'
```

## 2. Обычный выкат

1. Правки локально + dual changelog (`frontend/updates.js`, `ops-console/app/updates.js`, `CHANGELOG_TG.md`, bump `updates.js?v=`).
2. Скрипт выката: `backend/scripts/_deploy_<tag>.sh` (как на Windows / через Cursor «выкати»).
3. Загрузка:

```bash
bash scripts/mac-ship.sh 0m1
# или с доп. файлами:
bash scripts/mac-ship.sh 0m1 backend/services/opsQuality.js backend/services/silenceCatchup.js
```

Скрипт: scp в `/tmp/<tag>/` → remote `_deploy_<tag>.sh` → guard PROXY≥5.

## 3. Через Cursor на Mac

Те же skills: **loverussian-deploy** / **loverussian-fix-loop**.  
SSH host: `loverussian` или `root@loverussian.duckdns.org` (ключ в `~/.ssh/` после install).

## Важно

- `frontend` и `ops` index — разные имена (`index_frontend.html` / `index_ops.html`), иначе миниапп снова станет OPS.
- Не коммить `.env` и живые `proxies*.txt` без нужды; на VPS они уже в `backend/.env`.
- **Private** `secrets/ssh/id_ed25519` в git не лежит (только `.pub` + README). Локально — `~/.ssh/` или untracked copy для `install-ssh-mac.sh`.
- `mac-ship` с 0m2 сам читает `_deploy_<tag>.sh` и scp-ит нужные basename’ы.
