#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
python3 - <<'PY'
import re
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^PROXY_LIST=(.*)$',t,re.M)
pl=(m.group(1).strip() if m else '')
print('env_PROXY_LEN', len([x for x in pl.split(';') if x.strip()]))
PY
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; print("pm2_PROXY_LEN", len([x for x in pl.split(";") if x.strip()])); print("status", p["pm2_env"]["status"])'
grep -a 'Work (DC)' /root/.pm2/logs/tgbot-out.log | tail -1
grep -a 'Warm TG:' /root/.pm2/logs/tgbot-out.log | tail -1
