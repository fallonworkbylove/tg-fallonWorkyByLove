#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0lo}
echo "=== deploy 0lo wave ==="
cp -a "$SRC/softHumanGates.js" "$BASE/backend/services/softHumanGates.js"
cp -a "$SRC/softHumanLite.js" "$BASE/backend/services/softHumanLite.js"
cp -a "$SRC/aiResponder.js" "$BASE/backend/services/aiResponder.js"
cp -a "$SRC/opsQuality.js" "$BASE/backend/services/opsQuality.js"
cp -a "$SRC/adminConsoleStats.js" "$BASE/backend/services/adminConsoleStats.js"
cp -a "$SRC/_smoke_wave_0lo.js" "$BASE/backend/scripts/_smoke_wave_0lo.js"
cp -a "$SRC/frontend_app.js" "$BASE/frontend/app.js"
cp -a "$SRC/frontend_styles.css" "$BASE/frontend/styles.css"
cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
cp -a "$SRC/index.html" "$BASE/frontend/index.html"
mkdir -p "$BASE/ops-console/app"
cp -a "$SRC/ops_index.html" "$BASE/ops-console/app/index.html"
cp -a "$SRC/ops_renderer.js" "$BASE/ops-console/app/renderer.js"
cp -a "$SRC/ops_styles.css" "$BASE/ops-console/app/styles.css"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
grep -q applyWave0loGates "$BASE/backend/services/softHumanGates.js"
grep -q applyWave0loGates "$BASE/backend/services/softHumanLite.js"
grep -q 'openaiCircuitOpenUntil\|circuit OPEN' "$BASE/backend/services/aiResponder.js"
grep -q runWaitingLeadsWatch "$BASE/backend/services/opsQuality.js"
grep -q day-bar "$BASE/ops-console/app/renderer.js"
grep -q 'updates.js?v=245' "$BASE/frontend/index.html"
grep -q 'Живее ответы и удобнее доска' "$BASE/frontend/updates.js"
grep -q '## 0lo\.' "$BASE/CHANGELOG_TG.md"
cd "$BASE/backend"
node scripts/_smoke_wave_0lo.js
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
pm2 restart tgbot --update-env
pm2 save
sleep 4
bash scripts/_deploy_guard.sh
echo DONE_0lo
