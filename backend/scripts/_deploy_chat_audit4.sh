#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SVC="$BASE/backend/services"
MED="$BASE/backend/media"
SCR="$BASE/backend/scripts"
FE="$BASE/frontend"

for f in objectionHandler aiResponder softHumanLite mediaReplies mediaSend humanThinLayer; do
  test -f "/tmp/${f}.js" || { echo "missing /tmp/${f}.js"; exit 1; }
  cp -a "/tmp/${f}.js" "$SVC/"
done
test -f /tmp/captions.json
cp -a /tmp/captions.json "$MED/"
if [ -f "$SVC/captions.json" ]; then cp -a /tmp/captions.json "$SVC/captions.json"; fi
mkdir -p "$SCR"
cp -a /tmp/_smoke_chat_audit4.js "$SCR/"

if [ -f /tmp/fe_audit4/updates.js ]; then
  cp -a /tmp/fe_audit4/updates.js "$FE/updates.js"
fi
if [ -f /tmp/fe_audit4/index.html ]; then
  cp -a /tmp/fe_audit4/index.html "$FE/index.html"
fi

cd "$BASE/backend"
OPENAI_API_KEY=sk-test node scripts/_smoke_chat_audit4.js
pm2 restart tgbot --update-env
sleep 2
pm2 ls | head -20
echo DEPLOY_CHAT_AUDIT4_OK
