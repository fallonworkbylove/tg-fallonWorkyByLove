#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/0gh
# ensure files landed (in case prior deploy hung before copy finished — copies already ran)
for f in humanIdeas10.js memoryTriggers.js humanExtra.js humanHardening.js opsQuality.js lifeTexture.js aiResponder.js replyPipeline.js softHumanLite.js; do
  [ -f "$SRC/$f" ] && cp -a "$SRC/$f" "$BASE/backend/services/"
done
[ -f "$SRC/updates.js" ] && cp -a "$SRC/updates.js" "$BASE/frontend/"
[ -f "$SRC/index.html" ] && cp -a "$SRC/index.html" "$BASE/frontend/"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

cd "$BASE/backend"
# keep proxy alive
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
[ "$n" -ge 5 ] || exit 1
timeout 90 pm2 restart tgbot --update-env
pm2 save
sleep 6
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; print({"status":p["pm2_env"]["status"],"proxy":len([x for x in pl.split(";") if x])})'
test -f "$BASE/backend/services/humanIdeas10.js" && echo HAS_IDEAS10
grep -c maybeLifeLagMs "$BASE/backend/services/replyPipeline.js" || true
grep -n 'updates.js?v=' "$BASE/frontend/index.html" | head -1
grep -aF 'Живее как человек' "$BASE/frontend/updates.js" | head -1
echo FINISH_0GH_OK
