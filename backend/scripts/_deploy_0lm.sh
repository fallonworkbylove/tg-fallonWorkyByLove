#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0lm}
echo "=== deploy 0lm wave ==="
cp -a "$SRC/softHumanGates.js" "$BASE/backend/services/softHumanGates.js"
cp -a "$SRC/softHumanLite.js" "$BASE/backend/services/softHumanLite.js"
cp -a "$SRC/loginRate.js" "$BASE/backend/services/loginRate.js"
cp -a "$SRC/httpRateLimit.js" "$BASE/backend/middleware/httpRateLimit.js"
cp -a "$SRC/accounts.js" "$BASE/backend/routes/accounts.js"
cp -a "$SRC/adminOps.js" "$BASE/backend/services/adminOps.js"
cp -a "$SRC/_deploy_guard.sh" "$BASE/backend/scripts/_deploy_guard.sh"
cp -a "$SRC/_audit_c_full_now.sh" "$BASE/backend/scripts/_audit_c_full_now.sh"
cp -a "$SRC/_smoke_wave_0lm.js" "$BASE/backend/scripts/_smoke_wave_0lm.js"
cp -a "$SRC/_smoke_wave_0lj.js" "$BASE/backend/scripts/_smoke_wave_0lj.js"
chmod +x "$BASE/backend/scripts/_deploy_guard.sh" "$BASE/backend/scripts/_audit_c_full_now.sh"
cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
cp -a "$SRC/index.html" "$BASE/frontend/index.html"
mkdir -p "$BASE/ops-console/app"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
grep -q fixEmptyQuotedTitles "$BASE/backend/services/softHumanGates.js"
grep -q allowLoginAttempt "$BASE/backend/routes/accounts.js"
grep -q changelog_sync "$BASE/backend/scripts/_deploy_guard.sh"
grep -q HARD_AUDIT_FAST "$BASE/backend/scripts/_audit_c_full_now.sh"
grep -q 'updates.js?v=243' "$BASE/frontend/index.html"
grep -q 'Чище ответы и жёстче вход' "$BASE/frontend/updates.js"
grep -q '## 0lm\.' "$BASE/CHANGELOG_TG.md"
cd "$BASE/backend"
node scripts/_smoke_wave_0lm.js
node scripts/_smoke_greet_hyphen_0li.js
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
echo DONE_0lm
