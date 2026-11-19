#!/bin/bash
# 0gw: OPS phone-first changelog + miniapp updates (Electron files are local)
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0gw}
echo "=== deploy $SRC → 0gw ==="
cp -a "$SRC/updates.js" "$BASE/frontend/"
cp -a "$SRC/index.html" "$BASE/frontend/"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
mkdir -p "$BASE/ops-console/app"
if [ -f "$SRC/ops_updates.js" ]; then
  cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
fi
# optional: mirror phone OPS web assets if present on VPS
if [ -d "$BASE/ops-console/app" ] && [ -f "$SRC/styles.css" ]; then
  cp -a "$SRC/styles.css" "$BASE/ops-console/app/"
  cp -a "$SRC/ops_index.html" "$BASE/ops-console/app/index.html" 2>/dev/null || true
  cp -a "$SRC/renderer.js" "$BASE/ops-console/app/" 2>/dev/null || true
  cp -a "$SRC/adminPanel.js" "$BASE/ops-console/app/" 2>/dev/null || true
fi

cd "$BASE/backend"
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['PROXY_LIST','OPENAI_PROXY_LIST','BOT_TOKEN','PORT']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if m: print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo "PROXY_LEN=$n"
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

# no bot code change — skip restart unless needed for changelog only
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];pl=p["pm2_env"].get("PROXY_LIST")or"";print({"status":p["pm2_env"]["status"],"proxy":len([x for x in pl.split(";")if x.strip()])})'
grep -n 'updates.js?v=' "$BASE/frontend/index.html" | head -1
grep -n 'Операторская под телефон' "$BASE/frontend/updates.js" | head -1
echo DEPLOY_0GW_OK
