#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
export OPENAI_API_KEY=sk-smoke-test-not-real
echo "=== C audit 0jf ==="
node scripts/_hard_audit_0gc.js
node scripts/_hard_audit_0ht.js
node scripts/_hard_audit_full_0ht.js
echo "--- live ---"
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|outbound ' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | tail -15 || true
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -8 || true
grep -q humanIdeas17 services/humanHardening.js && echo WIRE_OK
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
PY
echo AUDIT_C_0JF_OK
