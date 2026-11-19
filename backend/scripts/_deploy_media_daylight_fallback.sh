#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cp -a /tmp/mdf/mediaSend.js "$BASE/backend/services/mediaSend.js"
cp -a /tmp/mdf/replyPipeline.js "$BASE/backend/services/replyPipeline.js"
cp -a /tmp/mdf/helpRequestNotifier.js "$BASE/backend/services/helpRequestNotifier.js"
cp -a /tmp/mdf/updates.js "$BASE/frontend/updates.js"
cp -a /tmp/mdf/index.html "$BASE/frontend/index.html"
grep -n 'Дневной фильтр\|failReason\|daylight' "$BASE/backend/services/mediaSend.js" "$BASE/backend/services/helpRequestNotifier.js" | head -20
cd "$BASE/backend" && node -e "
const ms=require('./services/mediaSend');
if(typeof ms.sendRequestedMediaOrDeflect!=='function') process.exit(2);
console.log('mediaSend_ok');
"
pm2 restart tgbot --update-env
echo DEPLOY_MEDIA_DAYLIGHT_OK
