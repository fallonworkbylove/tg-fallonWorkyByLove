#!/bin/bash
set -euo pipefail
echo "=== heal AUTH_KEY: stop → 180s → start ==="
pm2 stop tgbot
echo waiting_180s...
sleep 180
pm2 start tgbot --update-env
pm2 save
sleep 45
curl -sS http://127.0.0.1:3000/api/health; echo
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
if e['status']!='online': raise SystemExit('not online')
if n < 5: raise SystemExit('REFUSE_PROXY')
PY
echo DONE_HEAL
