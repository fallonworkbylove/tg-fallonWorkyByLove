#!/bin/bash
set -euo pipefail
SRC=${1:-/tmp/0m0}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

cp -f "$SRC/_hard_audit_full_0ht.js" backend/scripts/_hard_audit_full_0ht.js
cp -f "$SRC/_hard_audit_0ht.js" backend/scripts/_hard_audit_0ht.js
cp -f "$SRC/_hard_audit_0gc.js" backend/scripts/_hard_audit_0gc.js
cp -f "$SRC/_ultra_hard_audit.js" backend/scripts/_ultra_hard_audit.js
cp -f "$SRC/_smoke_project_harden_0lz.js" backend/scripts/_smoke_project_harden_0lz.js
cp -f "$SRC/proxyPools.js" backend/services/proxyPools.js
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
grep -q 'updates.js?v=257' frontend/index.html
grep -q 'Проверка после выката точнее' frontend/updates.js
grep -q '## 0m0\.' CHANGELOG_TG.md
grep -q 'process.exit(0)' backend/scripts/_hard_audit_0ht.js

(
  export OPENAI_API_KEY=sk-test
  node backend/scripts/_smoke_project_harden_0lz.js
  node backend/scripts/_hard_audit_0lz.js
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
echo DEPLOY_0m0_OK
