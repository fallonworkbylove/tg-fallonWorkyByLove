#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cp -a /tmp/madm/app.js "$BASE/frontend/app.js"
cp -a /tmp/madm/styles.css "$BASE/frontend/styles.css"
cp -a /tmp/madm/index.html "$BASE/frontend/index.html"
cp -a /tmp/madm/updates.js "$BASE/frontend/updates.js"
grep -n 'data-tab="admin"' "$BASE/frontend/index.html" | head -5
grep -n 'getAdminConsole\|syncAdminVisibility\|isAdmin' "$BASE/frontend/app.js" | head -15
echo DEPLOY_MINIAPP_ADMIN_OK
