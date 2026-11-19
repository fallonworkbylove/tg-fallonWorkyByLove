#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/0gp
cp -a "$SRC/proxyPools.js" "$SRC/clientPool.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_proxy_failover_0gn.js" "$BASE/backend/scripts/"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
cd "$BASE/backend"
node scripts/_smoke_proxy_failover_0gn.js
eval "$(python3 - <<'PY'
import re
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','BOT_TOKEN','PORT']:
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
timeout 90 pm2 restart tgbot --update-env
pm2 save
sleep 70
python3 - <<'PY'
t=open('/root/.pm2/logs/tgbot-out.log','rb').read().decode('utf-8','replace')[-25000:]
for pat in ['Warm TG: OK','активирован','подключ','завершен','ошибка','DEAD']:
    print(pat, t.count(pat))
print('---')
for line in t.splitlines()[-50:]:
    if any(x in line for x in ['Warm TG:','Аккаунт','заверш','Не удалось','DEAD','сразу на','подключ','ошибка','Восстан']):
        print(line[:230])
if 'завершен' in t:
    print('BOOTSTRAP_DONE')
else:
    print('BOOTSTRAP_PENDING')
PY
echo DEPLOY_0GP_OK
