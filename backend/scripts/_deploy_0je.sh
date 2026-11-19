#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0je}
echo "=== deploy 0je pink-purple style ==="
cp -a "$SRC/styles.css" "$BASE/frontend/"
cp -a "$SRC/app.js" "$BASE/frontend/"
cp -a "$SRC/index.html" "$BASE/frontend/"
[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/ops_updates.js" ] && mkdir -p "$BASE/ops-console/app" && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
cp -a "$SRC/_smoke_pink_0je.js" "$BASE/backend/scripts/"
cd "$BASE"
grep -q -- '--primary: #e879c8' frontend/styles.css
grep -q 'fdf2f8' frontend/styles.css
grep -q 'styles.css?v=78' frontend/index.html
grep -q 'app.js?v=168' frontend/index.html
grep -q 'Снова розово-фиолетовый вид' frontend/updates.js
sed -i 's/\r$//' backend/scripts/_smoke_pink_0je.js || true
node backend/scripts/_smoke_pink_0je.js
touch frontend/styles.css frontend/app.js frontend/index.html frontend/updates.js
curl -sS http://127.0.0.1:3000/api/health; echo
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
n=len([x for x in (p['pm2_env'].get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':p['pm2_env']['status'],'PROXY':n})
if n < 5: raise SystemExit('REFUSE_PROXY')
PY
echo DONE_0je
