#!/bin/bash
set -euo pipefail
pkill -9 -f '_smoke_interest_hits|_smoke_10of10|_smoke_human_hardening|_deploy_0gv' 2>/dev/null || true
sleep 1
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/0gv
cp -a "$SRC/humanHardening.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_interest_hits_0gv.js" "$BASE/backend/scripts/"
cp -a "$SRC/updates.js" "$BASE/frontend/"
cp -a "$SRC/index.html" "$BASE/frontend/"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
if [ -f "$SRC/ops_updates.js" ] && [ -d "$BASE/ops-console/app" ]; then
  cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
fi
cd "$BASE/backend"
node --check services/humanHardening.js
timeout 20 node scripts/_smoke_interest_hits_0gv.js

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','BOT_TOKEN','PORT','ADMIN_ALERT_CHAT_ID','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s' % (key, shlex.quote(m.group(1).strip())))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo "PROXY_LEN=$n"
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

pm2 restart tgbot --update-env
pm2 save
sleep 5
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];pl=p["pm2_env"].get("PROXY_LIST")or"";print({"status":p["pm2_env"]["status"],"proxy":len([x for x in pl.split(";")if x.strip()])})'
grep -n 'NFT_MIN_INTEREST_HITS' "$BASE/backend/services/humanHardening.js" | head -2
grep -n 'updates.js?v=' "$BASE/frontend/index.html" | head -1
grep -n 'Кампания не ждёт' "$BASE/frontend/updates.js" | head -1
echo FINISH_0GV_OK
