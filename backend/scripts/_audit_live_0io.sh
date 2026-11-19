#!/bin/bash
set -e
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
cd "$ROOT/backend"

echo "=== LIVE OUT ==="
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|outbound ' /root/.pm2/logs/tgbot-out.log | tail -30 || true
echo "=== LIVE ERR ==="
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY|TypeError|SyntaxError' /root/.pm2/logs/tgbot-error.log | tail -30 || true
echo "=== PROXY ==="
python3 - <<'PY'
import re, json
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^PROXY_LIST=(.*)$',t,re.M)
pl=(m.group(1).strip() if m else '')
print('env_PROXY_LEN', len([x for x in pl.split(';') if x.strip()]))
PY
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; print({"status":p["pm2_env"]["status"],"pm2_PROXY_LEN":len([x for x in pl.split(";") if x.strip()])})'
echo "=== AUTH/CORS gates ==="
python3 - <<'PY'
import re
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
for k in ('TELEGRAM_AUTH_BYPASS','TELEGRAM_AUTH_BYPASS_FORCE'):
    m=re.search(rf'^{k}=(.*)$',t,re.M)
    print(k, (m.group(1).strip() if m else 'missing'))
cors=re.search(r'^CORS_ORIGIN=(.*)$',t,re.M)
print('CORS_ORIGIN', (cors.group(1).strip() if cors else 'missing')[:80])
PY
grep -n "fallback.*1\|getUserId" ../backend/lib/getUserId.js 2>/dev/null | head -5 || grep -n "getUserId\|fallback" lib/getUserId.js 2>/dev/null | head -8 || true
echo "=== HARD 0io ==="
node scripts/_hard_audit_0io.js
echo "=== HARD 0ht ==="
node scripts/_hard_audit_0ht.js
echo "=== HARD FULL ==="
node scripts/_hard_audit_full_0ht.js
echo "=== SMOKE 0io ==="
node scripts/_smoke_human16_0io.js
if [ -f scripts/_ultra_hard_audit.js ]; then
  echo "=== ULTRA ==="
  node scripts/_ultra_hard_audit.js || echo "ULTRA_SOFT_OR_SKIP"
fi
echo "DONE_AUDIT_0io"
