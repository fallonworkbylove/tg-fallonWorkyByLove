#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0hq}
echo "=== deploy 0hq 10/10 stubs/typos ==="

cp -a "$SRC/softHumanLite.js" "$BASE/backend/services/"
cp -a "$SRC/humanHardening.js" "$BASE/backend/services/"
cp -a "$SRC/aiResponder.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_10of10_0hq.js" "$BASE/backend/scripts/"
cp -a "$SRC/_ultra_hard_audit.js" "$BASE/backend/scripts/"
[ -f "$SRC/_smoke_antistub_silence_0hf.js" ] && cp -a "$SRC/_smoke_antistub_silence_0hf.js" "$BASE/backend/scripts/"

if [ -f "$SRC/frontend_updates.js" ]; then cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
elif [ -f "$SRC/updates.js" ]; then cp -a "$SRC/updates.js" "$BASE/frontend/updates.js"; fi
if [ -f "$SRC/frontend_index.html" ]; then cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
elif [ -f "$SRC/index.html" ]; then cp -a "$SRC/index.html" "$BASE/frontend/index.html"; fi
if [ -f "$SRC/ops_updates.js" ]; then cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"; fi
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
[ -f "$SRC/AUDIT_HARD_0hq.md" ] && cp -a "$SRC/AUDIT_HARD_0hq.md" "$BASE/"

cd "$BASE/backend"
OPENAI_API_KEY=sk-test node scripts/_smoke_10of10_0hq.js
OPENAI_API_KEY=sk-test node scripts/_smoke_antistub_silence_0hf.js
OPENAI_API_KEY=sk-test node scripts/_smoke_kaif_0hm.js 2>/dev/null | tail -8 || true

python3 - <<'PY'
import re
from pathlib import Path
p=Path('.env'); t=p.read_text(encoding='utf-8',errors='replace')
m=re.search(r'^PROXY_LIST=(.*)$',t,re.M)
pl=(m.group(1).strip() if m else '')
n=len([x for x in pl.split(';') if x.strip()])
print('env_PROXY_LEN', n)
if n < 5:
    raise SystemExit('REFUSE_PROXY env')
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

grep -q 'поддеожк' "$BASE/backend/services/aiResponder.js"
grep -q 'помню как тебя' "$BASE/backend/services/humanHardening.js"
grep -q 'ultraShort' "$BASE/backend/services/softHumanLite.js"

pm2 restart tgbot --update-env
pm2 save
sleep 12
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e["status"],"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()]),"BYPASS":e.get("TELEGRAM_AUTH_BYPASS")})'
grep -n 'updates.js?v=' "$BASE/frontend/index.html" | head -1
grep -n 'пустых кивков' "$BASE/frontend/updates.js" | head -1

# live ultra after ship window
FIX_SINCE=$(date -u +'%Y-%m-%d %H:%M:%S')
echo "AUDIT_FIX_SINCE=$FIX_SINCE"
OPENAI_API_KEY=sk-x AUDIT_FIX_SINCE="$FIX_SINCE" node scripts/_ultra_hard_audit.js > /tmp/ultra_0hq.json 2>/tmp/ultra_0hq.err || true
python3 <<'PY'
import json
raw=open('/tmp/ultra_0hq.json',encoding='utf-8',errors='ignore').read()
i=raw.find('{'); j=raw.rfind('}')
d=json.loads(raw[i:j+1])
print('overall', d.get('overall'))
print('checks', d.get('checks'))
print('FINDINGS:')
for f in d.get('findings') or []:
    print('-', f.get('sev'), f.get('cat'), f.get('name'), f.get('detail'))
p0=sum(1 for f in d.get('findings') or [] if f.get('sev')=='P0')
print('P0_COUNT', p0)
print('VERDICT_LINE', '10/10' if d.get('overall',0)>=9.95 and p0==0 and not d.get('findings') else d.get('overall'))
PY
login_n=$(grep -cE '^socks5' "$BASE/backend/config/proxies-login.txt" || true)
echo login_lines=$login_n
echo DEPLOY_0HQ_OK
