#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
cd "$ROOT/backend"
export OPENAI_API_KEY=sk-smoke-test-not-real

echo '=== smoke media 0jh ==='
timeout 45 node scripts/_smoke_media_strip_0jh.js

echo '=== smoke human 0jg ==='
timeout 45 node scripts/_smoke_human_0jg.js

echo '=== hard audit 0jh ==='
timeout 45 node scripts/_hard_audit_0jh.js

echo '=== health / PROXY ==='
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
print('PROXY_OK')
PY

echo '=== OUT live ==='
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|Дайджест отсева|outbound ' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -30 || true

echo '=== ERR live ==='
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY|AUTH_KEY_DUPLICATED|OPENAI' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -20 || true

echo 'AUDIT_B_0JH_DONE'
