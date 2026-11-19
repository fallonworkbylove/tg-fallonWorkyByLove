#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0jb}
echo "=== deploy 0jb AUTH no-block wave ==="

cp -a "$SRC/clientPool.js" "$BASE/backend/services/"
cp -a "$SRC/sessionBootstrap.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_auth_dup_0iw.js" "$BASE/backend/scripts/"
[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/frontend_index.html" ] && cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
[ -f "$SRC/ops_updates.js" ] && mkdir -p "$BASE/ops-console/app" && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

cd "$BASE/backend"
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
grep -q 'forceCloseClient' "$BASE/backend/services/clientPool.js"
grep -q 'пропускаю (retry позже)' "$BASE/backend/services/clientPool.js"
grep -q '300_000' "$BASE/backend/services/sessionBootstrap.js"
grep -q 'updates.js?v=182' "$BASE/frontend/index.html"

PID=$(pm2 pid tgbot 2>/dev/null || true)
if [ -n "${PID:-}" ] && [ "$PID" != "0" ]; then
  kill -TERM "$PID" || true
  for i in $(seq 1 20); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
fi
pm2 stop tgbot || true
sleep 5
pkill -TERM -f 'tg-miniapp-loverussian/backend/server' 2>/dev/null || true
sleep 3
echo 'waiting 300s DC release...'
sleep 300
pm2 start tgbot --update-env
pm2 save
sleep 40
for i in 1 2 3 4 5 6 7 8; do
  h=$(curl -sS http://127.0.0.1:3000/api/health || echo '{}')
  echo "check_$i $h"
  echo "$h" | grep -qE '"online":([1-9]|[1-9][0-9])' && break
  sleep 30
done
grep -aE 'активирован|ok=|fail=|retry позже|повтор' /root/.pm2/logs/tgbot-out.log | tail -35
curl -sS http://127.0.0.1:3000/api/health; echo
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
if e['status']!='online' or n<5: raise SystemExit(1)
PY
echo DONE_0jb
