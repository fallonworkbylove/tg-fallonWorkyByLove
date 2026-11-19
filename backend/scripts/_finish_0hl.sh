#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
echo "=== frontend bump ==="
grep -oE 'updates.js\?v=[0-9]+' "$ROOT/frontend/index.html"
head -c 120 "$ROOT/frontend/updates.js"; echo
echo "=== ops updates title ==="
grep -n "Подписи" "$ROOT/ops-console/app/updates.js" | head -2
echo "=== PROXY_LEN ==="
node -e '
const {execSync}=require("child_process");
const e=execSync("pm2 env 0",{encoding:"utf8"});
const m=e.match(/PROXY_LIST[^\n]*/);
if(!m){console.log("NO_PROXY"); process.exit(0)}
const v=m[0].split("=").slice(1).join("=");
console.log("PROXY_LEN", (v||"").split(",").filter(Boolean).length);
'
echo "=== 0hl ok ==="
