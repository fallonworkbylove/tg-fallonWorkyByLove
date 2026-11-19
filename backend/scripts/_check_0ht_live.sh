#!/bin/bash
set -euo pipefail
grep -aE 'волна|восстановлено|активирован' /root/.pm2/logs/tgbot-out.log | tail -25 || true
echo '---'
pm2 jlist | python3 - <<'PY'
import json,sys
j=json.load(sys.stdin)
p=[x for x in j if x["name"]=="tgbot"][0]
e=p["pm2_env"]
pl=e.get("PROXY_LIST") or ""
print({"status": e["status"], "PROXY": len([x for x in pl.split(";") if x.strip()])})
PY
grep -oE 'updates.js\?v=[0-9]+' /root/opt/tgbot/tg-miniapp-loverussian/frontend/index.html | head -1
echo LIVE_0HT_OK
