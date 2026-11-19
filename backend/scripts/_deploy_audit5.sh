#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SVC=$BASE/backend/services
cp -a /tmp/a5/softHumanLite.js "$SVC/"
cp -a /tmp/a5/aiResponder.js "$SVC/"
cp -a /tmp/a5/objectionHandler.js "$SVC/"
cp -a /tmp/a5/mediaReplies.js "$SVC/"
cp -a /tmp/a5/mediaSend.js "$SVC/"
cp -a /tmp/a5/replyPipeline.js "$SVC/"
cp -a /tmp/a5/_smoke_chat_audit5.js "$BASE/backend/scripts/"
cp -a /tmp/a5/updates.js "$BASE/frontend/updates.js"
cp -a /tmp/a5/index.html "$BASE/frontend/index.html"
cd "$BASE/backend"
OPENAI_API_KEY=sk-test node scripts/_smoke_chat_audit5.js
pm2 restart tgbot --update-env
sleep 2
pm2 ls | head -12
echo DEPLOY_AUDIT5_OK
