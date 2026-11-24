#!/bin/bash
set -euo pipefail
SRC=${1:-/tmp/0t6}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

cp -f "$SRC/softHumanGates.js" backend/services/softHumanGates.js
cp -f "$SRC/replyGateRegistry.js" backend/services/replyGateRegistry.js
cp -f "$SRC/aiResponder.js" backend/services/aiResponder.js
cp -f "$SRC/messageAnalysis.js" backend/services/messageAnalysis.js
cp -f "$SRC/updates.js" frontend/updates.js
cp -f "$SRC/index.html" frontend/index.html
[ -f "$SRC/ops_updates.js" ] && [ -d ops-console/app ] && cp -f "$SRC/ops_updates.js" ops-console/app/updates.js
cp -f "$SRC/_smoke_0t6.js" backend/scripts/_smoke_0t6.js
cp -f "$SRC/CHANGELOG_TG.md" CHANGELOG_TG.md

grep -q 'applyWave0t6Gates' backend/services/softHumanGates.js
grep -q "id: '0t6'" backend/services/replyGateRegistry.js
grep -q '## 0t6\.' CHANGELOG_TG.md
grep -q 'updates.js?v=514' frontend/index.html

( export OPENAI_API_KEY=sk-test AUDIT_SMOKE=1; node backend/scripts/_smoke_0t6.js )

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text = Path('backend/.env').read_text(encoding='utf-8', errors='ignore')
for key in [
    'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'OPENAI_MODEL_LIGHT',
    'OPENAI_MODEL_COMPLEX', 'OPENAI_MODEL_FALLBACK', 'OPENAI_FALLBACK_KEY',
    'OPENAI_FALLBACK_BASE_URL', 'PROXY_LIST', 'OPENAI_PROXY_LIST', 'CORS_ORIGIN',
]:
    m = re.search(rf'^{re.escape(key)}=(.*)$', text, re.M)
    if m: print('export %s=%s' % (key, shlex.quote(m.group(1).strip())))
PY
)"
unset AUDIT_SMOKE || true
case "${OPENAI_API_KEY:-}" in ''|sk-deploy*|sk-audit*|sk-test*) echo REFUSE_OPENAI_FAKE; exit 1;; esac
n=$(python3 - <<'PY'
import os
print(len([x for x in os.environ.get('PROXY_LIST','').split(';') if x.strip()]))
PY
)
echo "PROXY_LEN=$n"; [ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }
pm2 restart tgbot --update-env; pm2 save; sleep 14
bash backend/scripts/_deploy_guard.sh
echo DEPLOY_0t6_OK
