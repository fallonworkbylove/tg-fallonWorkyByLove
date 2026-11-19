#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

echo "=== DB env ==="
python3 - <<'PY'
import re
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
for k in ['DB_HOST','DB_PORT','DB_NAME','DB_POOL_LIMIT','DB_USER']:
 m=re.search(rf'^{k}=(.*)$',t,re.M)
 print(k, (m.group(1).strip() if m else 'MISSING'))
PY

echo "=== mysql listen ==="
ss -lntp | grep -E '3306|mysqld' || echo 'NO_3306_LISTEN'
systemctl is-active mysql mariadb 2>/dev/null || true
mysqladmin ping --protocol=tcp -h127.0.0.1 2>&1 | head -3 || true

echo "=== health ==="
curl -sS http://127.0.0.1:3000/api/health; echo

echo "=== pm2 ==="
pm2 jlist > /tmp/pm2j_post.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j_post.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n,'restarts':e.get('restart_time')})
assert e['status']=='online' and n>=5
PY

echo "=== fresh 3306 after boot (last 3m via log timestamps if any) ==="
# count 3306 in last 200 error lines
tail -n 200 /root/.pm2/logs/tgbot-error.log | grep -c '3306' || true
tail -n 80 /root/.pm2/logs/tgbot-error.log | grep -E '3306|ECONNREFUSED' | tail -20 || true

echo "=== live human greps ==="
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|outbound ' /root/.pm2/logs/tgbot-out.log | tail -20 || true

echo "=== hard full ==="
export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-test}"
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
timeout 90 node scripts/_hard_audit_full_0ht.js || echo HARD_FULL_RC=$?
timeout 120 node scripts/_ultra_hard_audit.js || echo ULTRA_RC=$?

echo "=== CORS / getUserId gates ==="
grep -n "origin: '\*'" ../backend/server.js 2>/dev/null || grep -n 'origin:' server.js | head -5 || true
# find server
S=$(ls -1 /root/opt/tgbot/tg-miniapp-loverussian/backend/server.js 2>/dev/null)
python3 - <<'PY'
from pathlib import Path
p=Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/server.js')
t=p.read_text(encoding='utf-8',errors='ignore')
print('cors_star', "origin: '*'" in t or 'origin:"*"' in t)
print('has_cors', 'cors' in t.lower())
gu=Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/lib/getUserId.js')
g=gu.read_text(encoding='utf-8',errors='ignore') if gu.exists() else ''
print('getUserId_fallback_1', 'return 1' in g or '|| 1' in g)
PY

echo POST_0JL_CHECK_DONE
