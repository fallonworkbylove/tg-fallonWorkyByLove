#!/bin/bash
set -uo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
echo "=== post-audit 0lf ==="
grep -q 'Админка видит здоровье' "$BASE/frontend/updates.js" && echo UPDATES_OK
grep -q 'updates.js?v=237' "$BASE/frontend/index.html" && echo INDEX_V_OK
grep -q 'Админка видит здоровье' "$BASE/ops-console/app/updates.js" && echo OPS_UPDATES_OK

python3 - <<'PY'
import json, subprocess
raw = subprocess.check_output(['pm2', 'jlist'], text=True)
d = json.loads(raw)
e = d[0]['pm2_env']
pl = [x for x in str(e.get('PROXY_LIST') or '').split(';') if x.strip()]
print('pm2_status', e.get('status'))
print('PROXY_LEN', len(pl))
print('AUDIT_SMOKE', repr(e.get('AUDIT_SMOKE')))
PY

cd "$BASE/backend"
if [ -f scripts/_hard_audit_0ht.js ]; then
  node scripts/_hard_audit_0ht.js > /tmp/hard_0lf.txt 2>&1 || true
  tail -50 /tmp/hard_0lf.txt
else
  echo "NO_HARD_AUDIT_SCRIPT"
fi

# wiring checks for 0lf
grep -q 'runOpenAiReadyWatch' services/opsQuality.js && echo WIRE_openai_watch
grep -q 'HEARD_TAILS_SOFT' services/jobFlipAsk.js && echo WIRE_heard_ab
grep -q "type: 'sport'" services/memoryTriggers.js && echo WIRE_memory20
grep -q 'persona-preview' routes/adminConsole.js && echo WIRE_persona
grep -q 'funnelBoard' services/adminConsoleStats.js && echo WIRE_funnel

grep -aE 'OPENAI|REFUSE_PROXY|null\.chat' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -8 || true
grep -aE 'opsQuality|OPENAI_WATCH|OFFLINE_WATCH|schedulers' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -12 || true
bash scripts/_deploy_guard.sh || true
echo POST_AUDIT_0lf_DONE
