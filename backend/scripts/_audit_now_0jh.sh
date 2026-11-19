#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
export OPENAI_API_KEY=sk-smoke-test-not-real

echo "=== health / proxy ==="
curl -sS http://127.0.0.1:3000/api/health; echo
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n,'restarts':e.get('restart_time')})
assert e['status']=='online'
assert n >= 5, 'PROXY<5'
PY

echo "=== smoke 0jg / 0jf ==="
timeout 45 node scripts/_smoke_human_0jg.js
timeout 60 node scripts/_smoke_human_0jf.js || true

echo "=== hard 0ht ==="
timeout 90 node scripts/_hard_audit_0ht.js

echo "=== wiring ==="
grep -q humanIdeas18 services/humanHardening.js && echo WIRE_18_OK
grep -q humanIdeas17 services/humanHardening.js && echo WIRE_17_OK
grep -q 'как буду на месте' services/aiResponder.js && echo MEET_SOFT_OK
test -f ../frontend/updates.js && grep -q 'Ещё живее в переписке' ../frontend/updates.js && echo UPDATES_OK
grep -oE 'updates.js\?v=[0-9]+' ../frontend/index.html || true

echo "=== LIVE out ==="
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|outbound |skip reason=media_after|подожд|<<>>|Ошибка обработки' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | tail -40 || true

echo "=== LIVE err ==="
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY|TypeError|SyntaxError|AUTH_KEY' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -25 || true

echo "=== AUTH uniq ==="
grep -a 'AUTH_KEY_DUPLICATED' /root/.pm2/logs/tgbot-error.log 2>/dev/null | grep -oE 'аккаунт [0-9]+' | sort | uniq -c || true

echo AUDIT_NOW_OK
