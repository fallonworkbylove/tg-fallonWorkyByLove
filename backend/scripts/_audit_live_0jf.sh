#!/bin/bash
set -euo pipefail
echo '=== health ==='
curl -sS http://127.0.0.1:3000/api/health; echo
echo '=== PROXY ==='
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n,'uptime_ms':e.get('pm_uptime')})
PY
echo '=== OUT ==='
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|outbound ' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -25 || true
echo '=== ERR ==='
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY|AUTH_KEY_DUPLICATED|OPENAI' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -20 || true
