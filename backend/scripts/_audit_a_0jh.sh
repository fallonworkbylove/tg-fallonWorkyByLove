#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
export OPENAI_API_KEY=sk-smoke-test-not-real
timeout 45 node scripts/_smoke_media_strip_0jh.js
grep -q MEDIA_PROMISE_LEFTOVER_RE services/mediaSend.js && echo WIRE_OK
grep -q 'updates.js?v=188' ../frontend/index.html && echo V188_OK
curl -sS http://127.0.0.1:3000/api/health; echo
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
assert e['status']=='online' and n>=5
print('AUDIT_A_0JH_OK')
PY
