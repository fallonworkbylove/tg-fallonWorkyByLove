#!/bin/bash
set -euo pipefail
SRC=${1:-/tmp/0ly}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

# Distinct names — never scp two index.html into same folder
cp -f "$SRC/index_frontend.html" frontend/index.html
cp -f "$SRC/index_ops.html" ops-console/app/index.html
cp -f "$SRC/updates_fe.js" frontend/updates.js
cp -f "$SRC/updates_ops.js" ops-console/app/updates.js
cp -f "$SRC/CHANGELOG_TG.md" CHANGELOG_TG.md
cp -f "$SRC/_deploy_guard.sh" backend/scripts/_deploy_guard.sh

if grep -q 'операторская, вне Telegram' frontend/index.html; then
  echo REFUSE_FRONTEND_IS_OPS
  exit 1
fi
grep -q 'app-splash' frontend/index.html
grep -q 'updates.js?v=255' frontend/index.html
grep -q 'Миниапп снова с нормальным экраном' frontend/updates.js
grep -q '## 0ly\.' CHANGELOG_TG.md

bash backend/scripts/_deploy_guard.sh
echo DEPLOY_0ly_OK
