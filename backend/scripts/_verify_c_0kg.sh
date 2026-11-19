#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cp /tmp/_smoke_screen_bugs_0jz.js "$BASE/backend/scripts/_smoke_screen_bugs_0jz.js"
cd "$BASE/backend"
AUDIT_SMOKE=1 node scripts/_smoke_screen_bugs_0jz.js
grep -q b8ff3c ../frontend/styles.css
grep -q 'Space Grotesk' ../frontend/styles.css
grep -q hideAppSplash ../frontend/app.js
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
e=[x for x in j if x['name']=='tgbot'][0]['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
assert e['status']=='online' and n>=5
PY
echo AUDIT_C_OK
