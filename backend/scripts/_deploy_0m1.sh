#!/bin/bash
set -euo pipefail
SRC=${1:-/tmp/0m1}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

cp -f "$SRC/proxyPools.js" backend/services/proxyPools.js
cp -f "$SRC/opsQuality.js" backend/services/opsQuality.js
cp -f "$SRC/silenceCatchup.js" backend/services/silenceCatchup.js
cp -f "$SRC/softHumanLite.js" backend/services/softHumanLite.js
cp -f "$SRC/_ultra_hard_audit.js" backend/scripts/_ultra_hard_audit.js
cp -f "$SRC/_smoke_0m1.js" backend/scripts/_smoke_0m1.js
cp -f "$SRC/_deploy_guard.sh" backend/scripts/_deploy_guard.sh
cp -f "$SRC/index_frontend.html" frontend/index.html
cp -f "$SRC/index_ops.html" ops-console/app/index.html
cp -f "$SRC/updates_fe.js" frontend/updates.js
cp -f "$SRC/updates_ops.js" ops-console/app/updates.js
cp -f "$SRC/CHANGELOG_TG.md" CHANGELOG_TG.md

if grep -q 'операторская, вне Telegram' frontend/index.html; then
  echo REFUSE_FRONTEND_IS_OPS
  exit 1
fi
grep -q 'updates.js?v=258' frontend/index.html
grep -q 'Меньше ложных тревог' frontend/updates.js
grep -q '## 0m1\.' CHANGELOG_TG.md
grep -q 'uptime() < 600' backend/services/opsQuality.js
grep -q 'NIGHT_BYE_RE' backend/services/silenceCatchup.js

(
  export OPENAI_API_KEY=sk-test
  node backend/scripts/_smoke_0m1.js
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
echo DEPLOY_0m1_OK
