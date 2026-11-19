#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
cd "$ROOT/backend"
export OPENAI_API_KEY="${OPENAI_API_KEY:-$(grep -E '^OPENAI_API_KEY=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)}"
node scripts/_smoke_10of10_fixes.js
pm2 restart tgbot --update-env
sleep 3
pm2 pid tgbot
echo DEPLOY_OK
