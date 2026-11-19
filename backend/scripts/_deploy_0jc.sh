#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0jc}
echo "=== deploy 0jc account card text ==="
cp -a "$SRC/styles.css" "$BASE/frontend/"
cp -a "$SRC/app.js" "$BASE/frontend/"
cp -a "$SRC/index.html" "$BASE/frontend/"
[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/ops_updates.js" ] && mkdir -p "$BASE/ops-console/app" && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
[ -f "$SRC/_smoke_ui_text_0jc.js" ] && cp -a "$SRC/_smoke_ui_text_0jc.js" "$BASE/backend/scripts/"

cd "$BASE"
grep -q 'color: #eef0ff' frontend/styles.css
grep -q 'textLuma' frontend/app.js
grep -q 'styles.css?v=76' frontend/index.html
grep -q 'app.js?v=166' frontend/index.html
grep -q 'updates.js?v=183' frontend/index.html
grep -q 'Вернули текст на карточках' frontend/updates.js

# static only — no pm2 restart (keep sessions)
sed -i 's/\r$//' backend/scripts/_smoke_ui_text_0jc.js || true
node backend/scripts/_smoke_ui_text_0jc.js
curl -sS http://127.0.0.1:3000/api/health; echo
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
if n < 5: raise SystemExit('REFUSE_PROXY')
PY
echo DONE_0jc
