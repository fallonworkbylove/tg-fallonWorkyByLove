#!/bin/bash
set -euo pipefail
SRC=${1:-/tmp/0mp}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

sed -i 's/\r$//' "$SRC"/*.sh 2>/dev/null || true

cp -f "$SRC/learningDb.js" backend/services/learningDb.js
cp -f "$SRC/_smoke_0mp.js" backend/scripts/_smoke_0mp.js
cp -f "$SRC/index_frontend.html" frontend/index.html
cp -f "$SRC/index_ops.html" ops-console/app/index.html
cp -f "$SRC/updates_fe.js" frontend/updates.js
cp -f "$SRC/updates_ops.js" ops-console/app/updates.js
cp -f "$SRC/CHANGELOG_TG.md" CHANGELOG_TG.md
if [[ -f "$SRC/_deploy_guard.sh" ]]; then
  cp -f "$SRC/_deploy_guard.sh" backend/scripts/_deploy_guard.sh
  sed -i 's/\r$//' backend/scripts/_deploy_guard.sh
fi

pkill -f 'backend/scripts/_smoke_' 2>/dev/null || true
sleep 1

grep -q 'updates.js?v=282' frontend/index.html
grep -q 'обучение' frontend/updates.js
grep -q '## 0mp\.' CHANGELOG_TG.md
grep -q 'бывает\\s+по' backend/services/learningDb.js || grep -q 'бывает' backend/services/learningDb.js

(
  export OPENAI_API_KEY=sk-test
  export AUDIT_SMOKE=1
  node backend/scripts/_smoke_0mp.js
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
echo DEPLOY_0mp_OK
