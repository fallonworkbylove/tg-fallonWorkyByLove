#!/bin/bash
set -euo pipefail
SRC=${1:-/tmp/0lw}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

cp -f "$SRC/opsQuality.js" backend/services/opsQuality.js
cp -f "$SRC/_smoke_waiting_filter_0lw.js" backend/scripts/_smoke_waiting_filter_0lw.js
cp -f "$SRC/_cleanup_busy_heal_0lw.sh" backend/scripts/_cleanup_busy_heal_0lw.sh
cp -f "$SRC/updates_fe.js" frontend/updates.js
cp -f "$SRC/updates_ops.js" ops-console/app/updates.js
cp -f "$SRC/index_fe.html" frontend/index.html
cp -f "$SRC/index_ops.html" ops-console/app/index.html
cp -f "$SRC/CHANGELOG_TG.md" CHANGELOG_TG.md

(
  export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-deploy}"
  node backend/scripts/_smoke_waiting_filter_0lw.js
)

sed -i 's/\r$//' backend/scripts/_cleanup_busy_heal_0lw.sh
bash backend/scripts/_cleanup_busy_heal_0lw.sh

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
pl=os.environ.get('PROXY_LIST','')
print(len([x for x in pl.split(';') if x.strip()]))
PY
)
echo "PROXY_LEN=$n"
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

pm2 restart tgbot --update-env
pm2 save
sleep 10
bash backend/scripts/_deploy_guard.sh
grep -q 'updates.js?v=253' frontend/index.html
grep -q 'Пуш «ждут ответа» без архива' frontend/updates.js
grep -q '## 0lw\.' CHANGELOG_TG.md
echo DEPLOY_0lw_OK
