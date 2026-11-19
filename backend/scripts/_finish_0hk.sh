#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/0hk
cp -a "$SRC/replyPipeline.js" "$BASE/backend/services/"
cp -a "$SRC/silenceCatchup.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_sleep_media_0hk.js" "$BASE/backend/scripts/"
cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

cd "$BASE/backend"
# static-only smoke (no openai via mediaSend chain if we skip require)
python3 - <<'PY'
from pathlib import Path
pipe=Path('services/replyPipeline.js').read_text()
sc=Path('services/silenceCatchup.js').read_text()
assert 'медиа-просьба во сне' in pipe
assert 'mediaSeedEarly' in sc
assert 'timeInfo.isSleep && !isHardMediaRequest' in pipe
print('STATIC_SMOKE_OK')
PY

ALIVE='socks5:92.119.161.150:62657:66uC85M2ZJU5:xyFuQApb5NgB;socks5:104.164.205.112:63647:66uC85M2ZJU5:xyFuQApb5NgB;socks5:138.249.212.178:63683:66uC85M2ZJU5:xyFuQApb5NgB;socks5:45.139.54.158:63513:66uC85M2ZJU5:xyFuQApb5NgB;socks5:45.147.1.200:62509:66uC85M2ZJU5:xyFuQApb5NgB;socks5:194.104.237.233:63253:66uC85M2ZJU5:xyFuQApb5NgB;socks5:185.207.213.38:64029:66uC85M2ZJU5:xyFuQApb5NgB;socks5:130.49.17.174:62565:66uC85M2ZJU5:xyFuQApb5NgB;socks5:155.212.34.47:64393:66uC85M2ZJU5:xyFuQApb5NgB;socks5:168.81.64.94:8000:nFBMNd:QEntaw;socks5:168.81.66.214:8000:nFBMNd:QEntaw;socks5:168.81.65.185:8000:nFBMNd:QEntaw;socks5:72.56.182.199:8000:QbQaXK:LMF5Dm;socks5:72.56.184.168:8000:QbQaXK:LMF5Dm;socks5:209.127.51.109:8000:QbQaXK:LMF5Dm'
python3 - <<PY
import re
from pathlib import Path
alive='''$ALIVE'''
p=Path('.env'); t=p.read_text(encoding='utf-8',errors='replace')
t2=re.sub(r'^PROXY_LIST=.*$','PROXY_LIST='+alive,t,count=1,flags=re.M)
if t2==t: t2=t.rstrip()+'\nPROXY_LIST='+alive+'\n'
for key in ('TELEGRAM_AUTH_BYPASS','TELEGRAM_AUTH_BYPASS_FORCE'):
    if re.search(rf'^{key}=',t2,re.M):
        t2=re.sub(rf'^{key}=.*$',f'{key}=false',t2,count=1,flags=re.M)
    else:
        t2=t2.rstrip()+f'\n{key}=false\n'
p.write_text(t2,encoding='utf-8')
print('PROXY_LEN', alive.count('socks5:'))
PY
echo '# env-only' > config/proxies.txt

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
export TELEGRAM_AUTH_BYPASS=false TELEGRAM_AUTH_BYPASS_FORCE=false
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || exit 1

pm2 restart tgbot --update-env
pm2 save
sleep 15
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e["status"],"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()]),"BYPASS":e.get("TELEGRAM_AUTH_BYPASS")})'
grep -n 'updates.js?v=' "$BASE/frontend/index.html" | head -1
echo FINISH_0HK_OK
