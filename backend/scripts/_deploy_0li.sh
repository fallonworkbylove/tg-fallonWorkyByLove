#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0li}
echo "=== deploy 0li greet hyphen /start ==="
cp -a "$SRC/softHumanLite.js" "$BASE/backend/services/softHumanLite.js"
cp -a "$SRC/humanIdeas15.js" "$BASE/backend/services/humanIdeas15.js"
cp -a "$SRC/_smoke_greet_hyphen_0li.js" "$BASE/backend/scripts/_smoke_greet_hyphen_0li.js"
cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
cp -a "$SRC/index.html" "$BASE/frontend/index.html"
mkdir -p "$BASE/ops-console/app"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
grep -q 'normalizeBareUserText' "$BASE/backend/services/softHumanLite.js"
grep -q 'fixSlashCommandReply' "$BASE/backend/services/softHumanLite.js"
grep -q 'updates.js?v=240' "$BASE/frontend/index.html"
grep -q 'Нормально отвечает на привет' "$BASE/frontend/updates.js"
grep -q '## 0li\.' "$BASE/CHANGELOG_TG.md"
cd "$BASE/backend"
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
echo DONE_0li
