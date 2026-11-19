#!/bin/bash
set -uo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE/backend"
echo "=== post-audit 0lf lite (C wiring) ==="
grep -q 'Админка видит здоровье' "$BASE/frontend/updates.js" && echo UPDATES_OK
grep -q 'updates.js?v=237' "$BASE/frontend/index.html" && echo INDEX_V_OK
python3 -c 'import json,subprocess;d=json.loads(subprocess.check_output(["pm2","jlist"],text=True));e=d[0]["pm2_env"];pl=[x for x in str(e.get("PROXY_LIST") or "").split(";") if x.strip()];print("pm2",e.get("status"),"PROXY",len(pl),"AUDIT",repr(e.get("AUDIT_SMOKE")))'
grep -q runOpenAiReadyWatch services/opsQuality.js && echo WIRE_openai
grep -q HEARD_TAILS_SOFT services/jobFlipAsk.js && echo WIRE_heard
grep -q "type: 'sport'" services/memoryTriggers.js && echo WIRE_mem
grep -q persona-preview routes/adminConsole.js && echo WIRE_persona
grep -q funnelBoard services/adminConsoleStats.js && echo WIRE_funnel
grep -q admin-proxy-health "$BASE/frontend/index.html" && echo WIRE_ui_proxy
grep -q getCostSummary services/finetuneUsage.js && echo WIRE_cost
node scripts/_smoke_ops_board_0lf.js >/tmp/smoke0lf.txt 2>&1
tail -3 /tmp/smoke0lf.txt
bash scripts/_deploy_guard.sh
grep -aE 'opsQuality|schedulers: digest' /root/.pm2/logs/tgbot-out.log | tail -6 || true
echo POST_AUDIT_0lf_LITE_DONE
