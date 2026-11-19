#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0lf}
echo "=== deploy 0lf ops board + quiet pushes + W3/W4 lite ==="

cp -a "$SRC/adminOps.js" "$BASE/backend/services/adminOps.js"
cp -a "$SRC/adminConsoleStats.js" "$BASE/backend/services/adminConsoleStats.js"
cp -a "$SRC/opsQuality.js" "$BASE/backend/services/opsQuality.js"
cp -a "$SRC/finetuneUsage.js" "$BASE/backend/services/finetuneUsage.js"
cp -a "$SRC/jobFlipAsk.js" "$BASE/backend/services/jobFlipAsk.js"
cp -a "$SRC/memoryTriggers.js" "$BASE/backend/services/memoryTriggers.js"
cp -a "$SRC/aiResponder.js" "$BASE/backend/services/aiResponder.js"
cp -a "$SRC/scaleOps.js" "$BASE/backend/services/scaleOps.js"
cp -a "$SRC/adminConsole.js" "$BASE/backend/routes/adminConsole.js"
cp -a "$SRC/_smoke_ops_board_0lf.js" "$BASE/backend/scripts/_smoke_ops_board_0lf.js"
cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
cp -a "$SRC/index.html" "$BASE/frontend/index.html"
cp -a "$SRC/app.js" "$BASE/frontend/app.js"
cp -a "$SRC/styles.css" "$BASE/frontend/styles.css"
mkdir -p "$BASE/ops-console/app"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

grep -q 'work_alive' "$BASE/backend/services/adminOps.js"
grep -q 'runOpenAiReadyWatch' "$BASE/backend/services/opsQuality.js"
grep -q 'funnelBoard' "$BASE/backend/services/adminConsoleStats.js"
grep -q 'HEARD_TAILS_SOFT' "$BASE/backend/services/jobFlipAsk.js"
grep -q "type: 'sport'" "$BASE/backend/services/memoryTriggers.js"
grep -q 'persona-preview' "$BASE/backend/routes/adminConsole.js"
grep -q 'admin-proxy-health' "$BASE/frontend/index.html"
grep -q 'admin-proxy-health' "$BASE/frontend/styles.css"
grep -q 'updates.js?v=237' "$BASE/frontend/index.html"
grep -q 'Админка видит здоровье и воронку' "$BASE/frontend/updates.js"
grep -q '## 0lf\.' "$BASE/CHANGELOG_TG.md"

cd "$BASE/backend"
node scripts/_smoke_ops_board_0lf.js
unset AUDIT_SMOKE || true

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^PROXY_LIST=(.*)$',text,re.M)
if m: print('export PROXY_LIST=%s'%shlex.quote(m.group(1).strip()))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

unset AUDIT_SMOKE || true
pm2 restart tgbot --update-env
pm2 save
sleep 3
sed -i 's/\r$//' scripts/_deploy_guard.sh
bash scripts/_deploy_guard.sh
echo DONE_0lf
