#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/job_churn

cp -a "$SRC/jobFlipAsk.js" "$BASE/backend/services/"
cp -a "$SRC/churnLearn.js" "$BASE/backend/services/"
cp -a "$SRC/learningDb.js" "$BASE/backend/services/"
cp -a "$SRC/aiResponder.js" "$BASE/backend/services/"
cp -a "$SRC/objectionHandler.js" "$BASE/backend/services/"
cp -a "$SRC/humanThinLayer.js" "$BASE/backend/services/"
cp -a "$SRC/softHumanLite.js" "$BASE/backend/services/"
cp -a "$SRC/peers.js" "$BASE/backend/services/"
cp -a "$SRC/server.js" "$BASE/backend/"
cp -a "$SRC/_smoke_job_flip_churn.js" "$BASE/backend/scripts/"
cp -a "$SRC/_hard_audit_job_churn.js" "$BASE/backend/scripts/"
cp -a "$SRC/updates.js" "$BASE/frontend/"
cp -a "$SRC/index.html" "$BASE/frontend/"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

cd "$BASE/backend"
node scripts/_smoke_job_flip_churn.js
node scripts/_hard_audit_job_churn.js

# Короткий рестарт — AI снова online сразу
pm2 restart tgbot --update-env
sleep 3
pm2 describe tgbot | head -14
echo DONE_0fr
