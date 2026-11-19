#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0ic}
echo "=== deploy 0ic triage permanence + anti-dup ==="

cp -a "$SRC/scaleOps.js" "$BASE/backend/services/"
cp -a "$SRC/softHumanLite.js" "$BASE/backend/services/" 2>/dev/null || true
cp -a "$SRC/humanIdeas12.js" "$BASE/backend/services/"
cp -a "$SRC/inbound.js" "$BASE/backend/services/"
cp -a "$SRC/replyPipeline.js" "$BASE/backend/services/"
cp -a "$SRC/silenceCatchup.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_triage_0ic.js" "$BASE/backend/scripts/"
cp -a "$SRC/_smoke_scale_0ht.js" "$BASE/backend/scripts/" 2>/dev/null || true

if [ -f "$SRC/frontend_updates.js" ]; then cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"; fi
if [ -f "$SRC/frontend_index.html" ]; then cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"; fi
if [ -f "$SRC/ops_updates.js" ]; then cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"; fi
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

cd "$BASE/backend"
node scripts/_smoke_triage_0ic.js

python3 - <<'PY'
import re
from pathlib import Path
p=Path('.env'); t=p.read_text(encoding='utf-8',errors='replace')
m=re.search(r'^PROXY_LIST=(.*)$',t,re.M)
pl=(m.group(1).strip() if m else '')
n=len([x for x in pl.split(';') if x.strip()])
print('env_PROXY_LEN', n)
if n < 5: raise SystemExit('REFUSE_PROXY env')
for key in ('TELEGRAM_AUTH_BYPASS','TELEGRAM_AUTH_BYPASS_FORCE'):
    if re.search(rf'^{key}=',t,re.M):
        t=re.sub(rf'^{key}=.*$',f'{key}=false',t,count=1,flags=re.M)
    else:
        t=t.rstrip()+f'\n{key}=false\n'
p.write_text(t,encoding='utf-8')
PY

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','BOT_TOKEN','PORT','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','CORS_ORIGIN','ADMIN_CONSOLE_TOKEN','TELEGRAM_AUTH_BYPASS','TELEGRAM_AUTH_BYPASS_FORCE']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
export TELEGRAM_AUTH_BYPASS=false TELEGRAM_AUTH_BYPASS_FORCE=false
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

grep -q 'isPermanenceMoveAsk' "$BASE/backend/services/scaleOps.js"
grep -q 'reengageInFlight' "$BASE/backend/services/inbound.js"
grep -q 'isNearDupOutbound' "$BASE/backend/services/replyPipeline.js"
grep -q 'Переезд «с концами»' "$BASE/frontend/updates.js"

pm2 restart tgbot --update-env
pm2 save
sleep 10
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
print({'status':e['status'],'PROXY':len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])})
PY
grep -oE 'updates.js\?v=[0-9]+' "$BASE/frontend/index.html" | head -1
echo DEPLOY_0IC_OK
