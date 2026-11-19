#!/bin/bash
set -euo pipefail
SRC=${1:-/tmp/0m2}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

cp -f "$SRC/replyGateRegistry.js" backend/services/replyGateRegistry.js
cp -f "$SRC/softHumanLite.js" backend/services/softHumanLite.js
cp -f "$SRC/opsLiveMetrics.js" backend/services/opsLiveMetrics.js
cp -f "$SRC/_smoke_wave_0m2.js" backend/scripts/_smoke_wave_0m2.js
cp -f "$SRC/_hard_audit_0m2.js" backend/scripts/_hard_audit_0m2.js
cp -f "$SRC/_hard_audit_full_0ht.js" backend/scripts/_hard_audit_full_0ht.js

cp -f "$SRC/index_frontend.html" frontend/index.html
cp -f "$SRC/updates_fe.js" frontend/updates.js
cp -f "$SRC/updates_ops.js" ops-console/app/updates.js
cp -f "$SRC/CHANGELOG_TG.md" CHANGELOG_TG.md
# mac-ship / gitignore — optional on VPS (Mac-side tooling)
mkdir -p scripts
if [[ -f "$SRC/mac-ship.sh" ]]; then
  cp -f "$SRC/mac-ship.sh" scripts/mac-ship.sh
fi
if [[ -f "$SRC/.gitignore" ]]; then
  cp -f "$SRC/.gitignore" .gitignore
fi

if grep -q 'операторская, вне Telegram' frontend/index.html; then
  echo REFUSE_FRONTEND_IS_OPS
  exit 1
fi
grep -q 'app-splash' frontend/index.html
grep -q 'updates.js?v=259' frontend/index.html
grep -q 'Живее без клише' frontend/updates.js
grep -q 'Живее без клише' ops-console/app/updates.js
grep -q '## 0m2\.' CHANGELOG_TG.md
grep -q 'fixLiveClicheOveruse' backend/services/replyGateRegistry.js
grep -q 'replyGateRegistry' backend/services/softHumanLite.js
grep -q 'CLICHE_TRACK' backend/services/opsLiveMetrics.js

(
  export OPENAI_API_KEY=sk-test
  unset AUDIT_SMOKE || true
  node backend/scripts/_smoke_wave_0m2.js
  node backend/scripts/_hard_audit_0m2.js
)

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text = Path('backend/.env').read_text(encoding='utf-8', errors='ignore')
for key in ['OPENAI_API_KEY', 'PROXY_LIST', 'OPENAI_PROXY_LIST']:
    m = re.search(rf'^{re.escape(key)}=(.*)$', text, re.M)
    if m:
        print('export %s=%s' % (key, shlex.quote(m.group(1).strip())))
PY
)"
unset AUDIT_SMOKE || true
case "${OPENAI_API_KEY:-}" in
  ''|sk-deploy*|sk-audit*|sk-test*) echo REFUSE_OPENAI_FAKE; exit 1;;
esac
n=$(python3 - <<'PY'
import os
print(len([x for x in os.environ.get('PROXY_LIST','').split(';') if x.strip()]))
PY
)
echo "PROXY_LEN=$n"
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

pm2 restart tgbot --update-env
pm2 save
sleep 12
bash backend/scripts/_deploy_guard.sh
echo DEPLOY_0m2_OK
