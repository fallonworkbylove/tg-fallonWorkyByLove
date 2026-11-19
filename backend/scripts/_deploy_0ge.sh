#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/0ge
cp -a "$SRC/peers.js" "$BASE/backend/services/"
cp -a "$SRC/humanHardening.js" "$BASE/backend/services/"
cp -a "$SRC/nftCampaign.js" "$BASE/backend/services/"
cp -a "$SRC/replyPipeline.js" "$BASE/backend/services/"
cp -a "$SRC/objectionHandler.js" "$BASE/backend/services/"
cp -a "$SRC/helpRequestNotifier.js" "$BASE/backend/services/"
cp -a "$SRC/updates.js" "$BASE/frontend/"
cp -a "$SRC/index.html" "$BASE/frontend/"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
cp -a "$SRC/_smoke_10of10_gates.js" "$BASE/backend/scripts/"
cp -a "$SRC/_smoke_human_hardening.js" "$BASE/backend/scripts/"
[ -d "$BASE/ops-console/app" ] && cp -a "$SRC/updates_ops.js" "$BASE/ops-console/app/updates.js" || echo "(no ops-console)"

cd "$BASE/backend"
ALIVE='socks5:209.127.51.109:8000:QbQaXK:LMF5Dm;socks5:23.229.75.249:8000:QbQaXK:LMF5Dm;socks5:154.30.136.63:8000:QbQaXK:LMF5Dm;socks5:173.209.232.164:8000:QbQaXK:LMF5Dm;socks5:173.209.233.42:8000:QbQaXK:LMF5Dm;socks5:168.81.66.214:8000:nFBMNd:QEntaw;socks5:72.56.182.199:8000:QbQaXK:LMF5Dm;socks5:72.56.184.168:8000:QbQaXK:LMF5Dm;socks5:72.56.181.78:8000:QbQaXK:LMF5Dm'
python3 - <<PY
from pathlib import Path
import re
alive='''$ALIVE'''
p=Path('.env'); t=p.read_text(encoding='utf-8',errors='replace')
t2=re.sub(r'^PROXY_LIST=.*$','PROXY_LIST='+alive,t,count=1,flags=re.M) if re.search(r'^PROXY_LIST=',t,re.M) else t.rstrip()+'\nPROXY_LIST='+alive+'\n'
p.write_text(t2,encoding='utf-8')
px=Path('config/proxies.txt')
if px.exists():
    px.write_text('',encoding='utf-8')
PY
eval "$(python3 - <<'PY'
import re
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','ADMIN_CONSOLE_TOKEN','PROXY_LIST','PROXY_LIST_LOGIN','PROXY_FILE','PROXY_FILE_LOGIN','BOT_TOKEN','PORT','ADMIN_ALERT_CHAT_ID']:
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
node scripts/_smoke_10of10_gates.js
node scripts/_smoke_human_hardening.js
timeout 90 pm2 restart tgbot --update-env
pm2 save
sleep 8
node -e 'const {execSync}=require("child_process");const j=JSON.parse(execSync("pm2 jlist",{encoding:"utf8"}));const p=j.find(x=>x.name==="tgbot");const pl=p.pm2_env.PROXY_LIST||"";console.log({status:p.pm2_env.status,proxy:pl.split(";").filter(Boolean).length,restarts:p.pm2_env.restart_time});'
grep -n 'isFolderFrozen\|peer_nft_gates\|Ошибка long polling' "$BASE/backend/services/peers.js" "$BASE/backend/services/humanHardening.js" "$BASE/backend/services/helpRequestNotifier.js" | head -20
grep -n 'updates.js?v=' "$BASE/frontend/index.html" | head -1
grep -aF 'Десять из десяти' "$BASE/frontend/updates.js" | head -1
echo DEPLOY_0GE_OK
