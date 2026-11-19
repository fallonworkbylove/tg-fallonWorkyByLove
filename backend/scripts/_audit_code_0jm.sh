#!/bin/bash
# Live+static hard C snapshot for 0jm planning (read-only)
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian/backend
cd "$BASE"

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"

echo "=== PROXY/PM2 ==="
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
pm2 jlist > /tmp/pm2j_0jm.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j_0jm.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n,'uptime_s':int((__import__('time').time()*1000 - (e.get('pm_uptime') or 0))/1000)})
PY
curl -sS http://127.0.0.1:3000/api/health; echo

echo "=== LIVE OUT ==="
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|outbound |nft\.ogg|Фраза про работу' /root/.pm2/logs/tgbot-out.log | tail -40 || true
echo "=== LIVE ERR ==="
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY|ECONNREFUSED|TypeError|Unhandled|3306|Queue limit' /root/.pm2/logs/tgbot-error.log | tail -30 || true

echo "=== ULTRA ==="
timeout 120 node scripts/_ultra_hard_audit.js || true

echo "=== TIMERS grep ==="
rg -n "setInterval\(|setTimeout\(" services --glob '*.js' | head -80 || true

echo "=== readFileSync hot ==="
rg -n "readFileSync\(" services --glob '*.js' | head -40 || true

echo AUDIT_CODE_0JM_SNAP_DONE
