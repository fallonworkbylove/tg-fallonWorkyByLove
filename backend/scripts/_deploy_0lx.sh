#!/bin/bash
set -euo pipefail
SRC=${1:-/tmp/0lx}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

cp -f "$SRC/opsQuality.js" backend/services/opsQuality.js
cp -f "$SRC/silenceCatchup.js" backend/services/silenceCatchup.js
cp -f "$SRC/_smoke_waiting_night_0lx.js" backend/scripts/_smoke_waiting_night_0lx.js
cp -f "$SRC/updates_fe.js" frontend/updates.js
cp -f "$SRC/updates_ops.js" ops-console/app/updates.js
cp -f "$SRC/index_fe.html" frontend/index.html
cp -f "$SRC/index_ops.html" ops-console/app/index.html
cp -f "$SRC/CHANGELOG_TG.md" CHANGELOG_TG.md

(
  export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-deploy}"
  node backend/scripts/_smoke_waiting_night_0lx.js
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
grep -q 'updates.js?v=254' frontend/index.html
grep -q 'После 23 пуш' frontend/updates.js
grep -q '## 0lx\.' CHANGELOG_TG.md

# one heal window before 01 MSK
sleep 95
echo "--- post heal ---"
grep -aE 'silence-heal:|healed |очереди/Занята|Ответ для' /root/.pm2/logs/tgbot-out.log | tail -25
echo DEPLOY_0lx_OK
