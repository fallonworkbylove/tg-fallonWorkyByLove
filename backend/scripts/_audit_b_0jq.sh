#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo "=== audit B 0jq ==="
grep -n 'past_day2_nft_phase\|DAY2_AGE_MAX_H\|WINDOW_START_HOUR' services/dailyPhotos.js | head -10
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
timeout 40 node scripts/_smoke_daily_day2_only_0jq.js
if [ -f scripts/_hard_audit_0ht.js ]; then
  timeout 90 node scripts/_hard_audit_0ht.js || true
else
  echo NO_HARD_0ht
  ls scripts/_hard_audit*.js 2>/dev/null | tail -5 || true
fi
grep -aE 'past_day2|Планировщик запущен: окно' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | tail -6 || true
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; print({"status":p["pm2_env"]["status"],"pm2_PROXY_LEN":len([x for x in pl.split(";") if x.strip()])})'
echo AUDIT_B_0JQ_DONE
