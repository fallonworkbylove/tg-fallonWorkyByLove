#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0hj}
echo "=== deploy 0hj heal+stub+ops+proxy ==="

cp -a "$SRC/silenceCatchup.js" "$BASE/backend/services/"
cp -a "$SRC/humanHardening.js" "$BASE/backend/services/"
cp -a "$SRC/_hard_audit_0gc.js" "$BASE/backend/scripts/"
cp -a "$SRC/_smoke_heal_stub_0hj.js" "$BASE/backend/scripts/"
cp -a "$SRC/_setup_ops_origin_0hi.sh" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/_force_alive_proxy_pm2.sh" "$BASE/backend/scripts/" 2>/dev/null || true

[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/frontend_index.html" ] && cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
[ -f "$SRC/ops_updates.js" ] && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

# OPS origin + TLS (DNS already points here)
bash "$BASE/backend/scripts/_setup_ops_origin_0hi.sh" || echo "OPS_ORIGIN_SETUP_WARN"

# Strip dangerous bypass flags from prod .env (keep comments)
python3 - <<'PY'
import re
from pathlib import Path
p = Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/.env')
t = p.read_text(encoding='utf-8', errors='ignore')
orig = t
for key in ('TELEGRAM_AUTH_BYPASS', 'TELEGRAM_AUTH_BYPASS_FORCE'):
    t2 = re.sub(rf'^{key}=.*$', f'{key}=false', t, count=1, flags=re.M)
    if t2 == t and not re.search(rf'^{key}=', t, re.M):
        t = t.rstrip() + f'\n{key}=false\n'
    else:
        t = t2
p.write_text(t, encoding='utf-8')
print('bypass_flags_cleared', orig != t)
PY

cd "$BASE/backend"
OPENAI_API_KEY="${OPENAI_API_KEY:-sk-test}" node scripts/_smoke_heal_stub_0hj.js
OPENAI_API_KEY="${OPENAI_API_KEY:-sk-test}" node scripts/_smoke_antistub_silence_0hf.js
OPENAI_API_KEY="${OPENAI_API_KEY:-sk-test}" node scripts/_hard_audit_0gc.js

# Prefer TG-ok alive pool
if [ -f scripts/_force_alive_proxy_pm2.sh ]; then
  # force script restarts pm2 — run after we set files; skip double: patch env only here
  ALIVE='socks5:92.119.161.150:62657:66uC85M2ZJU5:xyFuQApb5NgB;socks5:104.164.205.112:63647:66uC85M2ZJU5:xyFuQApb5NgB;socks5:138.249.212.178:63683:66uC85M2ZJU5:xyFuQApb5NgB;socks5:45.139.54.158:63513:66uC85M2ZJU5:xyFuQApb5NgB;socks5:45.147.1.200:62509:66uC85M2ZJU5:xyFuQApb5NgB;socks5:193.201.127.216:63401:66uC85M2ZJU5:xyFuQApb5NgB;socks5:194.104.237.233:63253:66uC85M2ZJU5:xyFuQApb5NgB;socks5:185.207.213.38:64029:66uC85M2ZJU5:xyFuQApb5NgB;socks5:104.164.209.27:62913:66uC85M2ZJU5:xyFuQApb5NgB;socks5:130.49.17.174:62565:66uC85M2ZJU5:xyFuQApb5NgB;socks5:155.212.34.47:64393:66uC85M2ZJU5:xyFuQApb5NgB;socks5:168.81.64.94:8000:nFBMNd:QEntaw;socks5:168.81.66.214:8000:nFBMNd:QEntaw;socks5:168.81.65.185:8000:nFBMNd:QEntaw;socks5:72.56.182.199:8000:QbQaXK:LMF5Dm;socks5:72.56.184.168:8000:QbQaXK:LMF5Dm;socks5:72.56.181.78:8000:QbQaXK:LMF5Dm;socks5:209.127.51.109:8000:QbQaXK:LMF5Dm;socks5:23.229.75.249:8000:QbQaXK:LMF5Dm;socks5:154.30.136.63:8000:QbQaXK:LMF5Dm;socks5:168.80.83.53:8000:BfNHVZ:rZJ9Cn;socks5:168.80.83.236:8000:BfNHVZ:rZJ9Cn;socks5:168.80.81.136:8000:BfNHVZ:rZJ9Cn'
  python3 - <<PY
import re
from pathlib import Path
alive = '''$ALIVE'''
p = Path('.env')
t = p.read_text(encoding='utf-8', errors='replace')
t2 = re.sub(r'^PROXY_LIST=.*$', 'PROXY_LIST=' + alive, t, count=1, flags=re.M)
if t2 == t:
    t2 = t.rstrip() + '\nPROXY_LIST=' + alive + '\n'
p.write_text(t2, encoding='utf-8')
print('PROXY_LIST set', alive.count('socks5:'))
PY
  echo '# work proxies in PROXY_LIST only' > config/proxies.txt
fi

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','BOT_TOKEN','PORT','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','CORS_ORIGIN','ADMIN_CONSOLE_TOKEN']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

grep -q 'findUnfulfilledMediaGaps' "$BASE/backend/services/silenceCatchup.js"
grep -q 'listUserDialogs' "$BASE/backend/services/silenceCatchup.js"
grep -q 'Догоняет видео-просьбы' "$BASE/frontend/updates.js"

pm2 restart tgbot --update-env
pm2 save
sleep 10
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];pl=p["pm2_env"].get("PROXY_LIST")or"";print({"status":p["pm2_env"]["status"],"pm2_PROXY_LEN":len([x for x in pl.split(";")if x.strip()]),"bypass":p["pm2_env"].get("TELEGRAM_AUTH_BYPASS"),"cors":(p["pm2_env"].get("CORS_ORIGIN")or"")[:100]})'
grep -n 'updates.js?v=' "$BASE/frontend/index.html" | head -1

echo "--- ops https ---"
curl -s -o /dev/null -w 'ops_https=%{http_code}\n' --max-time 12 https://ops-loverussian.duckdns.org/ || echo ops_https=ERR
curl -s -o /dev/null -w 'ops_main=%{http_code}\n' --max-time 12 https://loverussian.duckdns.org/ops/

echo DEPLOY_0HJ_OK
