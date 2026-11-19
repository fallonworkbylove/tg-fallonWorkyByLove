#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/nu_ok
cp -a "$SRC/softHumanLite.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_soft_lite.js" "$BASE/backend/scripts/"
cp -a "$SRC/updates.js" "$BASE/frontend/"
cp -a "$SRC/index.html" "$BASE/frontend/"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
cd "$BASE/backend"
node scripts/_smoke_soft_lite.js
pm2 restart tgbot --update-env
sleep 2
pm2 describe tgbot | head -12
echo DONE
