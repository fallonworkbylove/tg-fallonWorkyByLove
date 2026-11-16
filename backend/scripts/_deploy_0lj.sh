#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0lj}
echo "=== deploy 0lj wave A1/B1/C1/B3/D1 ==="
cp -a "$SRC/softHumanGates.js" "$BASE/backend/services/softHumanGates.js"
cp -a "$SRC/softHumanLite.js" "$BASE/backend/services/softHumanLite.js"
cp -a "$SRC/aiResponder.js" "$BASE/backend/services/aiResponder.js"
cp -a "$SRC/opsLiveMetrics.js" "$BASE/backend/services/opsLiveMetrics.js"
cp -a "$SRC/adminConsoleStats.js" "$BASE/backend/services/adminConsoleStats.js"
cp -a "$SRC/adminConsole.js" "$BASE/backend/routes/adminConsole.js"
cp -a "$SRC/_smoke_wave_0lj.js" "$BASE/backend/scripts/_smoke_wave_0lj.js"
cp -a "$SRC/_check_getuserid_fallback.js" "$BASE/backend/scripts/_check_getuserid_fallback.js"
cp -a "$SRC/_audit_c_full_now.sh" "$BASE/backend/scripts/_audit_c_full_now.sh"
cp -a "$SRC/_cron_audit_c.sh" "$BASE/backend/scripts/_cron_audit_c.sh"
chmod +x "$BASE/backend/scripts/_audit_c_full_now.sh" "$BASE/backend/scripts/_cron_audit_c.sh"
cp -a "$SRC/app.js" "$BASE/frontend/app.js"
cp -a "$SRC/styles.css" "$BASE/frontend/styles.css"
cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
cp -a "$SRC/index.html" "$BASE/frontend/index.html"
mkdir -p "$BASE/ops-console/app"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
grep -q 'fixBotAccusationReply' "$BASE/backend/services/softHumanGates.js"
grep -q 'softHumanGates' "$BASE/backend/services/softHumanLite.js"
grep -q 'staleDialog' "$BASE/backend/services/opsLiveMetrics.js"
grep -q 'expire-stale' "$BASE/backend/routes/adminConsole.js"
grep -q 'updates.js?v=241' "$BASE/frontend/index.html"
grep -q 'Живее на «ты бот»' "$BASE/frontend/updates.js"
grep -q '## 0lj\.' "$BASE/CHANGELOG_TG.md"
cd "$BASE/backend"
node scripts/_check_getuserid_fallback.js
node scripts/_smoke_wave_0lj.js
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
# install daily cron if missing
if ! crontab -l 2>/dev/null | grep -q '_cron_audit_c.sh'; then
  (crontab -l 2>/dev/null; echo '15 3 * * * /bin/bash /root/opt/tgbot/tg-miniapp-loverussian/backend/scripts/_cron_audit_c.sh') | crontab -
  echo cron_audit_c_installed
fi
echo DONE_0lj
