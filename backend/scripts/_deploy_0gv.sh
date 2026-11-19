#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0gv}
echo "=== deploy 0gv from $SRC ==="
cp -a "$SRC/humanHardening.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_interest_hits_0gv.js" "$BASE/backend/scripts/"
cp -a "$SRC/_smoke_10of10_gates.js" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/_smoke_human_hardening.js" "$BASE/backend/scripts/" 2>/dev/null || true
cp -a "$SRC/updates.js" "$BASE/frontend/"
cp -a "$SRC/index.html" "$BASE/frontend/"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
[ -f "$SRC/ops_updates.js" ] && [ -d "$BASE/ops-console/app" ] && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js" || true

cd "$BASE/backend"
eval "$(python3 - <<'PY'
import re
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','BOT_TOKEN','PORT','ADMIN_ALERT_CHAT_ID','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    val=m.group(1).strip()
    if (val.startswith('"')and val.endswith('"'))or(val.startswith("'")and val.endswith("'")): val=val[1:-1]
    print("export %s=%s"%(key, __import__('shlex').quote(val)))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo "PROXY_LEN=$n"
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

node scripts/_smoke_interest_hits_0gv.js
node scripts/_smoke_10of10_gates.js
node scripts/_smoke_human_hardening.js

pm2 restart tgbot --update-env
pm2 save
sleep 6
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];pl=p["pm2_env"].get("PROXY_LIST")or"";print({"status":p["pm2_env"]["status"],"proxy":len([x for x in pl.split(";")if x.strip()])})'
grep -n 'updates.js?v=' "$BASE/frontend/index.html" | head -1
grep -n 'interestHits' "$BASE/backend/services/humanHardening.js" | head -5
grep -n 'NFT_MIN_INTEREST_HITS' "$BASE/backend/services/humanHardening.js" | head -3
echo DEPLOY_0GV_OK
