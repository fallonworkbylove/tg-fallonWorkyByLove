#!/bin/bash
set -euo pipefail
SRC=${1:-/tmp/0m9}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

cp -f "$SRC/softHumanGates.js" backend/services/softHumanGates.js
cp -f "$SRC/softHumanLite.js" backend/services/softHumanLite.js
cp -f "$SRC/replyGateRegistry.js" backend/services/replyGateRegistry.js
cp -f "$SRC/index_frontend.html" frontend/index.html
cp -f "$SRC/updates_fe.js" frontend/updates.js
cp -f "$SRC/updates_ops.js" ops-console/app/updates.js
cp -f "$SRC/CHANGELOG_TG.md" CHANGELOG_TG.md
cp -f "$SRC/_smoke_lead_shut_0m9.js" backend/scripts/_smoke_lead_shut_0m9.js
cp -f "$SRC/_hard_audit_0m9.js" backend/scripts/_hard_audit_0m9.js

if grep -q 'операторская, вне Telegram' frontend/index.html; then
  echo REFUSE_FRONTEND_IS_OPS
  exit 1
fi
grep -q 'updates.js?v=266' frontend/index.html
grep -q '## 0m9\.' CHANGELOG_TG.md
grep -q 'fixLeadShutDown' backend/services/softHumanGates.js
grep -q 'applyWave0m9Gates' backend/services/softHumanGates.js
grep -q 'НИКОГДА не отшивай общение' backend/services/softHumanLite.js

(
  export OPENAI_API_KEY=sk-test
  unset AUDIT_SMOKE || true
  node backend/scripts/_smoke_lead_shut_0m9.js
  node backend/scripts/_hard_audit_0m9.js
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
echo DEPLOY_0m9_OK
