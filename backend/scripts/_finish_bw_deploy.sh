#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/bw0fs
cp -a "$SRC/styles.css" "$BASE/frontend/"
cp -a "$SRC/updates.js" "$BASE/frontend/"
cp -a "$SRC/index.html" "$BASE/frontend/"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
cp -a "$SRC/_hard_audit_0fs.js" "$BASE/backend/scripts/"
cp -a "$SRC/_live_watch_15m.sh" /tmp/_live_watch_15m.sh
chmod +x /tmp/_live_watch_15m.sh
if [ -d "$BASE/ops-console/app" ]; then
  cp -a "$SRC/updates.js" "$BASE/ops-console/app/updates.js"
  echo ops_updates_copied
fi
# sometimes frontend is also under public
if [ -d /var/www/html ] && [ -f /var/www/html/updates.js ]; then
  cp -a "$SRC/updates.js" /var/www/html/updates.js || true
  cp -a "$SRC/styles.css" /var/www/html/styles.css || true
  cp -a "$SRC/index.html" /var/www/html/index.html || true
fi
echo "sizes:"
wc -c "$BASE/frontend/styles.css" "$BASE/frontend/updates.js" "$BASE/frontend/index.html"
grep -E 'styles.css|updates.js' "$BASE/frontend/index.html"
head -n 24 "$BASE/frontend/updates.js"
cd "$BASE/backend"
test -f services/jobFlipAsk.js
test -f services/churnLearn.js
node scripts/_hard_audit_0fs.js
pm2 describe tgbot | head -10
echo STATIC_DEPLOY_OK_NO_RESTART
