#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0ln}
echo "=== deploy 0ln funnel days ==="
cp -a "$SRC/leadScoring.js" "$BASE/backend/services/leadScoring.js"
cp -a "$SRC/adminConsoleStats.js" "$BASE/backend/services/adminConsoleStats.js"
cp -a "$SRC/adminMenu.js" "$BASE/backend/services/adminMenu.js"
cp -a "$SRC/objectionHandler.js" "$BASE/backend/services/objectionHandler.js"
cp -a "$SRC/accounts.js" "$BASE/backend/routes/accounts.js"
cp -a "$SRC/_smoke_funnel_days_0ln.js" "$BASE/backend/scripts/_smoke_funnel_days_0ln.js"
cp -a "$SRC/frontend_app.js" "$BASE/frontend/app.js"
cp -a "$SRC/frontend_styles.css" "$BASE/frontend/styles.css"
cp -a "$SRC/frontend_styles_pink_base.css" "$BASE/frontend/styles_pink_base.css"
cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
cp -a "$SRC/index.html" "$BASE/frontend/index.html"
mkdir -p "$BASE/ops-console/app"
cp -a "$SRC/ops_index.html" "$BASE/ops-console/app/index.html"
cp -a "$SRC/ops_renderer.js" "$BASE/ops-console/app/renderer.js"
cp -a "$SRC/ops_i18n.js" "$BASE/ops-console/app/i18n.js"
cp -a "$SRC/ops_styles.css" "$BASE/ops-console/app/styles.css"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
grep -q FUNNEL_BOARD_STAGES "$BASE/backend/services/leadScoring.js"
grep -q "STAGE_ORDER = \\['day1'" "$BASE/ops-console/app/renderer.js"
grep -q '3 день · NFT' "$BASE/frontend/app.js"
grep -q 'updates.js?v=244' "$BASE/frontend/index.html"
grep -q 'styles.css?v=107' "$BASE/frontend/index.html"
grep -q 'styles.css?v=133' "$BASE/ops-console/app/index.html"
grep -q 'Воронка по дням кампании' "$BASE/frontend/updates.js"
grep -q '## 0ln\.' "$BASE/CHANGELOG_TG.md"
cd "$BASE/backend"
node scripts/_smoke_funnel_days_0ln.js
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
bash scripts/_deploy_guard.sh
echo DONE_0ln
