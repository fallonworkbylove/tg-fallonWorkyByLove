#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0ij}
echo "=== deploy 0ij persona case + unslop ==="

mkdir -p "$BASE/prompts"
cp -a "$SRC/persona_slim.txt" "$BASE/prompts/"
cp -a "$SRC/personaFacts.js" "$BASE/backend/services/"
cp -a "$SRC/scaleOps.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_persona_case_0ij.js" "$BASE/backend/scripts/"
[ -f "$SRC/frontend_app.js" ] && cp -a "$SRC/frontend_app.js" "$BASE/frontend/app.js"
[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/frontend_index.html" ] && cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
[ -f "$SRC/ops_updates.js" ] && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

cd "$BASE/backend"
sed -i 's/\r$//' scripts/_deploy_0ij.sh scripts/_smoke_persona_case_0ij.js || true
node scripts/_smoke_persona_case_0ij.js

python3 - <<'PY'
import re
from pathlib import Path
p=Path('.env'); t=p.read_text(encoding='utf-8',errors='replace')
m=re.search(r'^PROXY_LIST=(.*)$',t,re.M)
n=len([x for x in (m.group(1).strip() if m else '').split(';') if x.strip()])
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
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','BOT_TOKEN','NOTIFY_BOT_TOKEN','PORT','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','CORS_ORIGIN','ADMIN_CONSOLE_TOKEN','TELEGRAM_AUTH_BYPASS','TELEGRAM_AUTH_BYPASS_FORCE']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
export TELEGRAM_AUTH_BYPASS=false TELEGRAM_AUTH_BYPASS_FORCE=false
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

grep -q FROM_CITY_IN "$BASE/prompts/persona_slim.txt"
grep -q 'Города в анкете' "$BASE/frontend/updates.js"
grep -q 'updates.js?v=164' "$BASE/frontend/index.html"
grep -q cityInPrep "$BASE/frontend/app.js"

pm2 restart tgbot --update-env
pm2 save
sleep 12
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
print({'status':e['status'],'PROXY':len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])})
PY
# live template sample
node -e "const t=require('./services/scaleOps').PERSONA_TEMPLATES.find(x=>x.id==='vika_timashevsk'); console.log((t&&t.prompt||'').split('\n')[0]); console.log((t&&t.prompt||'').split('\n')[1]);"
grep -oE 'updates.js\?v=[0-9]+' "$BASE/frontend/index.html" | head -1
echo DONE_0ij
