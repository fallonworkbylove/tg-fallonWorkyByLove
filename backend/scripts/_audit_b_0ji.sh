#!/bin/bash
set +e
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
cd "$ROOT/backend"
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','OPENAI_API_KEY','PROXY_LIST']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-smoke-test-not-real}"

echo '=== smoke 0ji ==='
timeout 50 node scripts/_smoke_bundle_0ji.js; echo SMOKE=$?

echo '=== hard 0ji ==='
timeout 50 node scripts/_hard_audit_0ji.js; echo HARD=$?

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

echo '=== NFT funnel DB ==='
timeout 40 node scripts/_diag_nft_now.js 2>/dev/null | tail -40

echo '=== OUT ==='
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|Перед NFT|голосовое про NFT|NFT reschedule|outbound ' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -30 || true
echo '=== ERR ==='
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY|AUTH_KEY_DUPLICATED|OPENAI|TypeError' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -15 || true

grep -oE 'updates.js\?v=[0-9]+' ../frontend/index.html | head -1
echo AUDIT_B_0JI_DONE
