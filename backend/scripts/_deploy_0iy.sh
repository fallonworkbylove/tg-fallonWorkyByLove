#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0iy}
echo "=== deploy 0iy stumps + hello ack ==="

cp -a "$SRC/humanIdeas14.js" "$BASE/backend/services/"
cp -a "$SRC/softHumanLite.js" "$BASE/backend/services/"
cp -a "$SRC/humanizeSpeech.js" "$BASE/backend/services/"
cp -a "$SRC/aiResponder.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_stumps_0iy.js" "$BASE/backend/scripts/"
[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/frontend_index.html" ] && cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
[ -f "$SRC/ops_updates.js" ] && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
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

sed -i 's/\r$//' scripts/_smoke_stumps_0iy.js || true
node scripts/_smoke_stumps_0iy.js

grep -q 'fixAckOnBareGreeting' "$BASE/backend/services/softHumanLite.js"
grep -q 'собираю вещи' "$BASE/backend/services/humanIdeas14.js"
grep -q 'Дописывает слова до конца' "$BASE/frontend/updates.js"
grep -q 'updates.js?v=179' "$BASE/frontend/index.html"

# Soft restart (SIGTERM → disconnect). Short grace — reply-only.
pm2 restart tgbot --update-env
pm2 save
sleep 16
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
print({'status':e['status'],'PROXY':len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])})
PY
curl -sS http://127.0.0.1:3000/api/health; echo
grep -oE 'updates.js\?v=[0-9]+' "$BASE/frontend/index.html"
echo DONE_0iy
