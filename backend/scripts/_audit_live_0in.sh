#!/bin/bash
set -e
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
cd "$ROOT"

echo "=== LIVE OUT ==="
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|outbound ' /root/.pm2/logs/tgbot-out.log | tail -30 || true
echo "=== LIVE ERR ==="
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY|TypeError|SyntaxError' /root/.pm2/logs/tgbot-error.log | tail -30 || true
echo "=== PM2/PROXY ==="
cd backend
python3 - <<'PY'
import re, json
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^PROXY_LIST=(.*)$',t,re.M)
pl=(m.group(1).strip() if m else '')
print('env_PROXY_LEN', len([x for x in pl.split(';') if x.strip()]))
PY
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; print({"status":p["pm2_env"]["status"],"pm2_PROXY_LEN":len([x for x in pl.split(";") if x.strip()])})'
echo "=== HARD AUDIT ==="
node scripts/_hard_audit_0ht.js
echo "=== HARD FULL (if present) ==="
if [ -f scripts/_hard_audit_full_0ht.js ]; then
  node scripts/_hard_audit_full_0ht.js || echo "HARD_FULL_SOFT_FAIL"
fi
echo "=== SMOKE 0in ==="
node scripts/_smoke_gender_stump_0in.js
echo "=== WIRING ==="
grep -n 'fixFemaleSelfForms' services/softHumanLite.js services/humanIdeas14.js services/aiResponder.js | head -20
grep -n 'иеогда\|Радкжн\|переписк\|испортил' services/humanIdeas14.js services/aiResponder.js | head -20
echo "DONE_AUDIT_0in"
