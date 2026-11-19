#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0hs}
echo "=== deploy 0hs login password UX ==="

cp -a "$SRC/loginAuth.js" "$BASE/backend/services/"
cp -a "$SRC/workerConnect.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_login_password_ui_0hs.js" "$BASE/backend/scripts/"
[ -f "$SRC/adminPanel.js" ] && cp -a "$SRC/adminPanel.js" "$BASE/ops-console/app/adminPanel.js"

if [ -f "$SRC/frontend_app.js" ]; then cp -a "$SRC/frontend_app.js" "$BASE/frontend/app.js"
elif [ -f "$SRC/app.js" ]; then cp -a "$SRC/app.js" "$BASE/frontend/app.js"; fi
if [ -f "$SRC/frontend_updates.js" ]; then cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
elif [ -f "$SRC/updates.js" ]; then cp -a "$SRC/updates.js" "$BASE/frontend/updates.js"; fi
if [ -f "$SRC/frontend_index.html" ]; then cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
elif [ -f "$SRC/index.html" ]; then cp -a "$SRC/index.html" "$BASE/frontend/index.html"; fi
if [ -f "$SRC/ops_updates.js" ]; then cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"; fi
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

cd "$BASE/backend"
node scripts/_smoke_login_password_ui_0hs.js

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

grep -q 'resolvePasswordNeeded' "$BASE/backend/services/loginAuth.js"
grep -q "showPassword = step === 'password'" "$BASE/frontend/app.js"

pm2 restart tgbot --update-env
pm2 save
sleep 10
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e["status"],"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()])})'
grep -oE 'updates.js\?v=[0-9]+|app.js\?v=[0-9]+' "$BASE/frontend/index.html" | head -5
grep -n 'Пароль при входе' "$BASE/frontend/updates.js" | head -1
echo DEPLOY_0HS_OK
