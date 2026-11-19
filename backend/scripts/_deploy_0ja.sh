#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0ja}
echo "=== deploy 0ja AUTH_KEY graceful SIGINT ==="

cp -a "$SRC/server.js" "$BASE/backend/"
cp -a "$SRC/clientPool.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_auth_dup_0iw.js" "$BASE/backend/scripts/"
[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/frontend_index.html" ] && cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
[ -f "$SRC/ops_updates.js" ] && mkdir -p "$BASE/ops-console/app" && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

cd "$BASE/backend"
python3 - <<'PY'
import re
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='replace')
m=re.search(r'^PROXY_LIST=(.*)$',t,re.M)
n=len([x for x in (m.group(1).strip() if m else '').split(';') if x.strip()])
print('env_PROXY_LEN', n)
if n < 5: raise SystemExit('REFUSE_PROXY env')
PY
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','BOT_TOKEN','PORT','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','CORS_ORIGIN','ADMIN_CONSOLE_TOKEN','LISTEN_HOST','NODE_ENV']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

sed -i 's/\r$//' scripts/_smoke_auth_dup_0iw.js || true
node scripts/_smoke_auth_dup_0iw.js

grep -q "gracefulShutdown('SIGINT')" "$BASE/backend/server.js"
grep -q 'жду 120с' "$BASE/backend/services/clientPool.js"
grep -q 'Номера снова поднимаются' "$BASE/frontend/updates.js"
grep -q 'updates.js?v=181' "$BASE/frontend/index.html"

# Старый процесс мог игнорить SIGINT: сначала SIGTERM (graceful disconnect), потом stop.
PID=$(pm2 pid tgbot 2>/dev/null || true)
if [ -n "${PID:-}" ] && [ "$PID" != "0" ]; then
  echo "SIGTERM pid=$PID (graceful disconnect)..."
  kill -TERM "$PID" || true
  for i in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
  done
fi
pm2 stop tgbot || true
sleep 5
if pgrep -f 'tg-miniapp-loverussian/backend/server' >/dev/null 2>&1; then
  echo 'WARN still alive, force TERM...'
  pkill -TERM -f 'tg-miniapp-loverussian/backend/server' || true
  sleep 8
fi
echo 'waiting 240s for DC auth_key release...'
sleep 240
pm2 start tgbot --update-env
pm2 save
sleep 70
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
if e['status']!='online': raise SystemExit('tgbot not online')
if n < 5: raise SystemExit('REFUSE_PROXY pm2')
PY
curl -sS http://127.0.0.1:3000/api/health; echo
grep -oE 'updates.js\?v=[0-9]+' "$BASE/frontend/index.html"
echo DONE_0ja
