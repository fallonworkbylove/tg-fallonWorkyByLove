#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
grep -q renderActivityFeed "$BASE/frontend/app.js"
grep -q worker-activity-list "$BASE/frontend/index.html"
grep -q accountIds "$BASE/backend/services/opsActivityLog.js"
grep -q "router.get('/activity'" "$BASE/backend/routes/accounts.js"
curl -sS http://127.0.0.1:3000/api/health; echo
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
e=[x for x in j if x['name']=='tgbot'][0]['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
assert e['status']=='online' and n>=5
PY
echo AUDIT_B_OK
