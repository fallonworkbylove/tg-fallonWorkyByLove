#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo '=== PM2 ==='
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; print({"status":p["pm2_env"]["status"],"pm2_PROXY_LEN":len([x for x in pl.split(";") if x.strip()]),"restarts":p["pm2_env"].get("restart_time")})'
echo '=== ENV ==='
python3 - <<'PY'
import re
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^PROXY_LIST=(.*)$',t,re.M)
pl=(m.group(1).strip() if m else '')
print('env_PROXY_LEN', len([x for x in pl.split(';') if x.strip()]))
PY
echo '=== OUT last replies ==='
grep -a 'Ответ для' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -15 || true
grep -a 'AI замолчал' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -5 || true
echo '=== ERR proxy/openai ==='
grep -aE 'SocksClientError|OPENAI|REFUSE_PROXY|fetch failed|429' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -15 || true
echo CHECK_DONE
