#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cp -a /tmp/mom_near/personaFacts.js "$BASE/backend/services/"
cp -a /tmp/mom_near/aiResponder.js "$BASE/backend/services/"
cp -a /tmp/mom_near/_smoke_mom_near.js "$BASE/backend/scripts/"
cp -a /tmp/mom_near/updates.js "$BASE/frontend/"
cp -a /tmp/mom_near/index.html "$BASE/frontend/"
cd "$BASE/backend"
OPENAI_API_KEY=sk-test node scripts/_smoke_mom_near.js
pm2 restart tgbot --update-env
echo DEPLOY_MOM_NEAR_OK
