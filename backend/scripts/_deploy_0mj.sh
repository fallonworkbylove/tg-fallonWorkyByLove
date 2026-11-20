#!/bin/bash
set -euo pipefail
SRC=${1:-/tmp/0mj}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

sed -i 's/\r$//' "$SRC"/*.sh 2>/dev/null || true

cp -f "$SRC/inbound.js" backend/services/inbound.js
cp -f "$SRC/humanExtra.js" backend/services/humanExtra.js
cp -f "$SRC/humanHardening.js" backend/services/humanHardening.js
cp -f "$SRC/softHumanGates.js" backend/services/softHumanGates.js
cp -f "$SRC/_smoke_0mj.js" backend/scripts/_smoke_0mj.js
cp -f "$SRC/index_frontend.html" frontend/index.html
cp -f "$SRC/index_ops.html" ops-console/app/index.html
cp -f "$SRC/updates_fe.js" frontend/updates.js
cp -f "$SRC/updates_ops.js" ops-console/app/updates.js
cp -f "$SRC/CHANGELOG_TG.md" CHANGELOG_TG.md
if [[ -f "$SRC/_deploy_guard.sh" ]]; then
  cp -f "$SRC/_deploy_guard.sh" backend/scripts/_deploy_guard.sh
  sed -i 's/\r$//' backend/scripts/_deploy_guard.sh
fi

grep -q 'updates.js?v=276' frontend/index.html
grep -q 'отвлеклась' frontend/updates.js
grep -q '## 0mj\.' CHANGELOG_TG.md
grep -q 'ой сорри)' backend/services/inbound.js
! grep -q 'сорри, отвлеклась)' backend/services/inbound.js

(
  export OPENAI_API_KEY=sk-test
  node backend/scripts/_smoke_0mj.js
)

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text = Path('backend/.env').read_text(encoding='utf-8', errors='ignore')
for key in ['OPENAI_API_KEY', 'PROXY_LIST', 'OPENAI_PROXY_LIST', 'CORS_ORIGIN']:
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
echo DEPLOY_0mj_OK
