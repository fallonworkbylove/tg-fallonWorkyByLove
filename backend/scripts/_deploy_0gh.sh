#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/0gh
for f in humanIdeas10.js memoryTriggers.js humanExtra.js humanHardening.js opsQuality.js lifeTexture.js aiResponder.js replyPipeline.js softHumanLite.js jobFlipAsk.js voiceReplies.js objectionHandler.js; do
  [ -f "$SRC/$f" ] && cp -a "$SRC/$f" "$BASE/backend/services/" || true
done
cp -a "$SRC/_smoke_human_ideas10.js" "$BASE/backend/scripts/"
cp -a "$SRC/_hard_audit_0gh.js" "$BASE/backend/scripts/"
cp -a "$SRC/_smoke_flip_voice_quote.js" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/_smoke_job_flip_churn.js" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/updates.js" "$BASE/frontend/"
cp -a "$SRC/index.html" "$BASE/frontend/"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
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
node scripts/_smoke_human_ideas10.js
node scripts/_hard_audit_0gh.js
node scripts/_smoke_flip_voice_quote.js
node scripts/_smoke_job_flip_churn.js
timeout 90 pm2 restart tgbot --update-env
pm2 save
sleep 6
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; print({"status":p["pm2_env"]["status"],"proxy":len([x for x in pl.split(";") if x]),"restarts":p["pm2_env"].get("restart_time")})'
grep -n 'humanIdeas10\|maybeLifeLagMs' "$BASE/backend/services/replyPipeline.js" | head -5
grep -n 'updates.js?v=' "$BASE/frontend/index.html" | head -1
grep -aF 'Живее как человек' "$BASE/frontend/updates.js" | head -1
# live hole greps
echo '--- LIVE ---'
grep -aE 'FROZEN_METHOD|PEER_ID_INVALID|REFUSE_PROXY' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -5 || true
grep -aE 'Ответ для|outbound voice|Пауза' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -8 || true
echo DEPLOY_0GH_OK
