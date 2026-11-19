#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0hi}
echo "=== deploy 0hi silence+night+ops ==="

cp -a "$SRC/silenceCatchup.js" "$BASE/backend/services/"
cp -a "$SRC/timing.js" "$BASE/backend/services/"
cp -a "$SRC/replyPipeline.js" "$BASE/backend/services/"
cp -a "$SRC/scanCatchup.js" "$BASE/backend/services/"
cp -a "$SRC/inbound.js" "$BASE/backend/services/"
cp -a "$SRC/telegramClient.js" "$BASE/backend/services/"
cp -a "$SRC/opsQuality.js" "$BASE/backend/services/"
cp -a "$SRC/_smoke_silence_night_ops_0hi.js" "$BASE/backend/scripts/"
cp -a "$SRC/_setup_ops_origin_0hi.sh" "$BASE/backend/scripts/"

[ -f "$SRC/ops-web-bridge.js" ] && cp -a "$SRC/ops-web-bridge.js" "$BASE/ops-console/app/"
[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/frontend_index.html" ] && cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
[ -f "$SRC/ops_updates.js" ] && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

# OPS origin (DNS/nginx/CORS) — best effort
bash "$BASE/backend/scripts/_setup_ops_origin_0hi.sh" || echo "OPS_ORIGIN_SETUP_WARN"

cd "$BASE/backend"
node scripts/_smoke_silence_night_ops_0hi.js

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
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

grep -q 'isNightTextQuietHour' "$BASE/backend/services/timing.js"
grep -q 'runSilenceCatchupHeal' "$BASE/backend/services/opsQuality.js"
grep -q 'ops-loverussian' "$BASE/ops-console/app/ops-web-bridge.js"

pm2 restart tgbot --update-env
pm2 save
sleep 8
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];pl=p["pm2_env"].get("PROXY_LIST")or"";print({"status":p["pm2_env"]["status"],"pm2_PROXY_LEN":len([x for x in pl.split(";")if x.strip()]),"cors":(p["pm2_env"].get("CORS_ORIGIN")or"")[:80]})'
grep -n 'updates.js?v=' "$BASE/frontend/index.html" | head -1
echo DEPLOY_0HI_OK
echo "(silence-heal стартует из opsQuality ~90с после boot)"
