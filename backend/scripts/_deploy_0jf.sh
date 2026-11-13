#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0jf}
echo "=== deploy 0jf live replies P0-P2 ==="

cp -a "$SRC/humanIdeas17.js" "$BASE/backend/services/"
cp -a "$SRC/humanIdeas14.js" "$BASE/backend/services/"
cp -a "$SRC/humanIdeas16.js" "$BASE/backend/services/" 2>/dev/null || true
cp -a "$SRC/humanHardening.js" "$BASE/backend/services/"
cp -a "$SRC/aiResponder.js" "$BASE/backend/services/"
cp -a "$SRC/objectionHandler.js" "$BASE/backend/services/"
cp -a "$SRC/humanThinLayer.js" "$BASE/backend/services/"
cp -a "$SRC/mediaSend.js" "$BASE/backend/services/"
cp -a "$SRC/softHumanLite.js" "$BASE/backend/services/"
cp -a "$SRC/learningDb.js" "$BASE/backend/services/"
cp -a "$SRC/personaFacts.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_human_0jf.js" "$BASE/backend/scripts/"
cp -a "$SRC/_smoke_human16_0io.js" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/_smoke_move_nude.js" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/_smoke_human_v2.js" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/_smoke_cheap_learn.js" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/_hard_audit_0gc.js" "$BASE/backend/scripts/" 2>/dev/null || true
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

sed -i 's/\r$//' scripts/_smoke_human_0jf.js scripts/_smoke_move_nude.js scripts/_smoke_human16_0io.js scripts/_smoke_cheap_learn.js 2>/dev/null || true
node scripts/_smoke_human_0jf.js
node scripts/_smoke_move_nude.js
node scripts/_smoke_human16_0io.js
node scripts/_smoke_cheap_learn.js

grep -q 'humanIdeas17' "$BASE/backend/services/humanHardening.js"
grep -q 'как буду на месте' "$BASE/backend/services/aiResponder.js"
grep -q 'Радужный — ГОРОД' "$BASE/backend/services/personaFacts.js"
grep -q 'Живее ответы: встречи' "$BASE/frontend/updates.js"
grep -q 'updates.js?v=186' "$BASE/frontend/index.html"

pm2 stop tgbot
echo "waiting 95s for DC session release..."
sleep 95
pm2 start tgbot --update-env
pm2 save
sleep 18
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
echo DONE_0jf
