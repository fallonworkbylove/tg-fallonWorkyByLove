#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0lp}
echo "=== deploy 0lp ==="
cp -a "$SRC/proxyPools.js" "$BASE/backend/services/proxyPools.js"
cp -a "$SRC/loginAuth.js" "$BASE/backend/services/loginAuth.js"
cp -a "$SRC/accounts.js" "$BASE/backend/routes/accounts.js"
cp -a "$SRC/_cron_audit_c.sh" "$BASE/backend/scripts/_cron_audit_c.sh"
cp -a "$SRC/_smoke_wave_0lp.js" "$BASE/backend/scripts/_smoke_wave_0lp.js"
chmod +x "$BASE/backend/scripts/_cron_audit_c.sh"
cp -a "$SRC/frontend_app.js" "$BASE/frontend/app.js"
cp -a "$SRC/frontend_styles.css" "$BASE/frontend/styles.css"
cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
cp -a "$SRC/index.html" "$BASE/frontend/index.html"
mkdir -p "$BASE/ops-console/app"
cp -a "$SRC/ops_index.html" "$BASE/ops-console/app/index.html"
cp -a "$SRC/ops_renderer.js" "$BASE/ops-console/app/renderer.js"
cp -a "$SRC/ops_i18n.js" "$BASE/ops-console/app/i18n.js"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
grep -q warmProbeLoginProxies "$BASE/backend/services/proxyPools.js"
grep -q bad-reply "$BASE/backend/routes/accounts.js"
grep -q sendAdminAlert "$BASE/backend/scripts/_cron_audit_c.sh"
grep -q 'updates.js?v=246' "$BASE/frontend/index.html"
grep -q 'Плохой ответ в один тап' "$BASE/frontend/updates.js"
grep -q '## 0lp\.' "$BASE/CHANGELOG_TG.md"
cd "$BASE/backend"
node scripts/_smoke_wave_0lp.js
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
echo DONE_0lp
