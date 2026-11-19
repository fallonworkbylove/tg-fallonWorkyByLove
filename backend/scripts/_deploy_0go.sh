#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/0go
for f in proxyPools.js clientPool.js aiResponder.js; do
  [ -f "$SRC/$f" ] && cp -a "$SRC/$f" "$BASE/backend/services/" || true
done
[ -f "$SRC/server.js" ] && cp -a "$SRC/server.js" "$BASE/backend/"
cp -a "$SRC/_smoke_proxy_failover_0gn.js" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/updates.js" "$BASE/frontend/"
cp -a "$SRC/index.html" "$BASE/frontend/"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
[ -d "$BASE/ops-console/app" ] && cp -a "$SRC/updates_ops.js" "$BASE/ops-console/app/updates.js" || echo "(no ops-console)"

cd "$BASE/backend"
ALIVE='socks5:168.81.64.94:8000:nFBMNd:QEntaw;socks5:168.81.66.214:8000:nFBMNd:QEntaw;socks5:168.81.65.185:8000:nFBMNd:QEntaw;socks5:72.56.182.199:8000:QbQaXK:LMF5Dm;socks5:72.56.184.168:8000:QbQaXK:LMF5Dm;socks5:72.56.181.78:8000:QbQaXK:LMF5Dm;socks5:209.127.51.109:8000:QbQaXK:LMF5Dm;socks5:23.229.75.249:8000:QbQaXK:LMF5Dm;socks5:154.30.136.63:8000:QbQaXK:LMF5Dm;socks5:173.209.232.164:8000:QbQaXK:LMF5Dm;socks5:173.209.233.42:8000:QbQaXK:LMF5Dm;socks5:168.80.83.53:8000:BfNHVZ:rZJ9Cn;socks5:168.80.83.236:8000:BfNHVZ:rZJ9Cn;socks5:168.80.81.136:8000:BfNHVZ:rZJ9Cn;socks5:91.216.186.238:8000:BfNHVZ:rZJ9Cn;socks5:185.168.250.239:8000:SJe5Co:cAwgFL;socks5:185.168.250.135:8000:SJe5Co:cAwgFL'
python3 - <<PY
from pathlib import Path
import re
alive='''$ALIVE'''
p=Path('.env'); t=p.read_text(encoding='utf-8',errors='replace')
t2=re.sub(r'^PROXY_LIST=.*$','PROXY_LIST='+alive,t,count=1,flags=re.M) if re.search(r'^PROXY_LIST=',t,re.M) else t.rstrip()+'\nPROXY_LIST='+alive+'\n'
p.write_text(t2,encoding='utf-8')
print('PROXY_SET', alive.count('socks5:'))
Path('config/proxies.txt').write_text('# work proxies live in PROXY_LIST only\n', encoding='utf-8')
PY
eval "$(python3 - <<'PY'
import re
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','ADMIN_CONSOLE_TOKEN','PROXY_LIST','BOT_TOKEN','PORT','ADMIN_ALERT_CHAT_ID','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    val=m.group(1).strip()
    if (val.startswith('"')and val.endswith('"'))or(val.startswith("'")and val.endswith("'")): val=val[1:-1]
    print("export %s='%s'"%(key,val.replace("'","'\"'\"'")))
PY
)"
n=$(echo "$PROXY_LIST" | tr ';' '\n' | grep -c socks5 || true)
echo "PROXY_LEN=$n"
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }
node scripts/_smoke_proxy_failover_0gn.js
timeout 90 pm2 restart tgbot --update-env
pm2 save
sleep 20
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; print({"status":p["pm2_env"]["status"],"proxy":len([x for x in pl.split(";") if x.strip()]),"restarts":p["pm2_env"].get("restart_time")})'
python3 - <<'PY'
t=open('/root/.pm2/logs/tgbot-out.log','rb').read().decode('utf-8','replace')[-16000:]
for pat in ['Warm TG:','Восстанавливаю','активирован','подключ','завершен','DEAD','сразу']:
    print(pat, t.count(pat))
print('---tail---')
for line in t.splitlines()[-25:]:
    if any(x in line for x in ['Warm','Аккаунт','proxy]','Восстан','заверш','Server','gramJS','Connecting']):
        print(line[:220])
PY
grep -n 'updates.js?v=' /root/opt/tgbot/tg-miniapp-loverussian/frontend/index.html | head -1
echo DEPLOY_0GO_OK
