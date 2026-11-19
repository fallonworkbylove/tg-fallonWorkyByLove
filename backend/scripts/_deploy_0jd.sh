#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0jd}
echo "=== deploy 0jd account text nuclear ==="
cp -a "$SRC/styles.css" "$BASE/frontend/"
cp -a "$SRC/app.js" "$BASE/frontend/"
cp -a "$SRC/index.html" "$BASE/frontend/"
[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/ops_updates.js" ] && mkdir -p "$BASE/ops-console/app" && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
cp -a "$SRC/_smoke_ui_text_0jd.js" "$BASE/backend/scripts/"

cd "$BASE"
grep -q 'fix-acc-text-0jd' frontend/index.html
grep -q 'styles.css?v=77' frontend/index.html
grep -q 'app.js?v=167' frontend/index.html
grep -q 'color:#eef0ff!important' frontend/app.js
grep -q 'Текст на номерах — повторный фикс' frontend/updates.js
sed -i 's/\r$//' backend/scripts/_smoke_ui_text_0jd.js || true
node backend/scripts/_smoke_ui_text_0jd.js
# touch mtimes so nginx/stat caches refresh
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
echo DONE_0jd
