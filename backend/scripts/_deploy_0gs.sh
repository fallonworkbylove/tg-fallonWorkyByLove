#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/0gs
cp -a "$SRC/replyPipeline.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_no_react_on_ask_0gs.js" "$BASE/backend/scripts/"
cp -a "$SRC/updates.js" "$BASE/frontend/"
cp -a "$SRC/index.html" "$BASE/frontend/"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
[ -d "$BASE/ops-console/app" ] && cp -a "$SRC/updates_ops.js" "$BASE/ops-console/app/updates.js" || true
cd "$BASE/backend"
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
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo "PROXY_LEN=$n"
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }
node scripts/_smoke_no_react_on_ask_0gs.js
timeout 90 pm2 restart tgbot --update-env
pm2 save
sleep 5
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];pl=p["pm2_env"].get("PROXY_LIST")or"";print({"status":p["pm2_env"]["status"],"proxy":len([x for x in pl.split(";")if x.strip()])})'
grep -n 'updates.js?v=' "$BASE/frontend/index.html" | head -1
echo DEPLOY_0GS_OK
