#!/bin/bash
set -e
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
cd "$ROOT/backend"

echo "=== LIVE ERR ==="
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY|TypeError|ReferenceError|SyntaxError' /root/.pm2/logs/tgbot-error.log | tail -25 || true
echo "=== PROXY/AUTH ==="
python3 - <<'PY'
import re
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^PROXY_LIST=(.*)$',t,re.M)
print('env_PROXY_LEN', len([x for x in (m.group(1).strip() if m else '').split(';') if x.strip()]))
for k in ('TELEGRAM_AUTH_BYPASS','TELEGRAM_AUTH_BYPASS_FORCE'):
    mm=re.search(rf'^{k}=(.*)$',t,re.M)
    print(k, mm.group(1).strip() if mm else 'missing')
PY
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; print({"status":p["pm2_env"]["status"],"pm2_PROXY_LEN":len([x for x in pl.split(";") if x.strip()])})'
echo "=== WIRING ==="
grep -n 'scheduleDeferredMediaReturn\|requireOpsLoopback\|shouldBlockMediaAfterPitchAsync\|flushDueDeferredMedia' services/replyPipeline.js services/inbound.js routes/accounts.js services/opsQuality.js | head -30
echo "=== SMOKE ==="
node scripts/_smoke_bugfix_0ip.js
echo "=== HARD 0ht ==="
node scripts/_hard_audit_0ht.js
echo "=== HARD FULL ==="
node scripts/_hard_audit_full_0ht.js
echo "=== ULTRA ==="
node scripts/_ultra_hard_audit.js 2>/dev/null | python3 -c 'import sys,json,re; t=sys.stdin.read(); i=t.find("{"); j=json.loads(t[i:]); print("overall",j.get("overall"),"findings",j.get("findings")); print("P0_security_fail",sum(1 for c in j.get("checks_detail",{}).get("security",[]) if not c.get("pass") and c.get("sev")=="P0"))'
echo "DONE_AUDIT_0ip"
