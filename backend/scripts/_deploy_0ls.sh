#!/bin/bash
# Deploy 0ls — peer photo not packed-things excuse
set -euo pipefail
SRC=${1:-/tmp/0ls}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

cp -f "$SRC/mediaSend.js" backend/services/mediaSend.js
cp -f "$SRC/_smoke_packed_things_0iq.js" backend/scripts/_smoke_packed_things_0iq.js
cp -f "$SRC/updates_fe.js" frontend/updates.js
cp -f "$SRC/updates_ops.js" ops-console/app/updates.js
cp -f "$SRC/index_fe.html" frontend/index.html
cp -f "$SRC/index_ops.html" ops-console/app/index.html
cp -f "$SRC/CHANGELOG_TG.md" CHANGELOG_TG.md

(
  export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-deploy}"
  node backend/scripts/_smoke_packed_things_0iq.js
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

pm2 restart tgbot --update-env
pm2 save
sleep 5
bash backend/scripts/_deploy_guard.sh

grep -q 'updates.js?v=249' frontend/index.html
grep -q 'На его фото больше не про коробки' frontend/updates.js
grep -q '## 0ls\.' CHANGELOG_TG.md
grep -q isPeerIncomingMediaCaption backend/services/mediaSend.js

echo DEPLOY_0ls_OK
