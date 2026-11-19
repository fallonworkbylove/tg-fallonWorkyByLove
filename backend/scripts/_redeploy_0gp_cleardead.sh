#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/0gp
cp -a "$SRC/proxyPools.js" "$SRC/clientPool.js" "$BASE/backend/services/"
cp -a "$SRC/sessionBootstrap.js" "$BASE/backend/services/"
cp -a "$SRC/server.js" "$BASE/backend/server.js"
cd "$BASE/backend"
ALIVE='socks5:168.81.64.94:8000:nFBMNd:QEntaw;socks5:168.81.66.214:8000:nFBMNd:QEntaw;socks5:168.81.65.185:8000:nFBMNd:QEntaw;socks5:72.56.182.199:8000:QbQaXK:LMF5Dm;socks5:72.56.184.168:8000:QbQaXK:LMF5Dm;socks5:72.56.181.78:8000:QbQaXK:LMF5Dm;socks5:209.127.51.109:8000:QbQaXK:LMF5Dm;socks5:23.229.75.249:8000:QbQaXK:LMF5Dm;socks5:154.30.136.63:8000:QbQaXK:LMF5Dm;socks5:173.209.232.164:8000:QbQaXK:LMF5Dm;socks5:173.209.233.42:8000:QbQaXK:LMF5Dm;socks5:168.80.83.53:8000:BfNHVZ:rZJ9Cn;socks5:168.80.83.236:8000:BfNHVZ:rZJ9Cn;socks5:168.80.81.136:8000:BfNHVZ:rZJ9Cn;socks5:91.216.186.238:8000:BfNHVZ:rZJ9Cn;socks5:185.168.250.239:8000:SJe5Co:cAwgFL;socks5:185.168.250.135:8000:SJe5Co:cAwgFL'
python3 - <<PY
from pathlib import Path
import re
alive='''$ALIVE'''
p=Path('.env'); t=p.read_text(encoding='utf-8',errors='replace')
t=re.sub(r'^PROXY_LIST=.*$','PROXY_LIST='+alive,t,count=1,flags=re.M) if re.search(r'^PROXY_LIST=',t,re.M) else t.rstrip()+'\nPROXY_LIST='+alive+'\n'
if re.search(r'^PROXY_CONNECT_DEADLINE_MS=',t,re.M):
    t=re.sub(r'^PROXY_CONNECT_DEADLINE_MS=.*$','PROXY_CONNECT_DEADLINE_MS=20000',t,count=1,flags=re.M)
else:
    t=t.rstrip()+'\nPROXY_CONNECT_DEADLINE_MS=20000\n'
p.write_text(t,encoding='utf-8')
Path('config/proxies.txt').write_text('# work proxies live in PROXY_LIST only\n', encoding='utf-8')
print('PROXY_SET', alive.count('socks5:'))
PY
eval "$(python3 - <<'PY'
import re
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','BOT_TOKEN','PORT','PROXY_CONNECT_DEADLINE_MS','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME']:
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
grep -q clearDeadProxies services/sessionBootstrap.js
grep -q '45_000' services/clientPool.js
node scripts/_smoke_proxy_failover_0gn.js
timeout 90 pm2 restart tgbot --update-env
pm2 save
echo "Waiting bootstrap 180s…"
sleep 180
python3 - <<'PY'
from pathlib import Path
out=Path('/root/.pm2/logs/tgbot-out.log').read_text('utf-8','replace')
i=out.rfind('[proxy] Warm TG: OK')
chunk=out[i:] if i>=0 else out[-12000:]
print('WARM', chunk.splitlines()[0][:200] if chunk else '?')
act=chunk.count(': активирован')
err=chunk.count(': ошибка')
rev=chunk.count('сессия мертва')
done='Восстановление сессий завершено' in chunk
print(f'activated={act} error={err} revoked={rev} done={done}')
for line in chunk.splitlines():
    if any(x in line for x in ['Warm TG:','Аккаунт','заверш','Восстан']):
        print(line[:230])
print('BOOTSTRAP_DONE' if done else 'BOOTSTRAP_PENDING')
PY
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; print({"pm2_PROXY_LEN":len([x for x in pl.split(";") if x.strip()]),"status":p["pm2_env"]["status"]})'
echo REDEPLOY_0GP_CLEARDEAD_OK
