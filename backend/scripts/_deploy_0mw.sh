#!/bin/bash
set -euo pipefail
SRC=${1:-/tmp/0mw}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

sed -i 's/\r$//' "$SRC"/*.sh 2>/dev/null || true

cp -f "$SRC/_hard_audit_full_0ht.js" backend/scripts/_hard_audit_full_0ht.js
for f in _hard_audit_0m1.js _hard_audit_0m2.js _hard_audit_0m3.js _hard_audit_0m7.js _smoke_0mw.js; do
  [[ -f "$SRC/$f" ]] && cp -f "$SRC/$f" "backend/scripts/$f"
done
cp -f "$SRC/index_frontend.html" frontend/index.html
cp -f "$SRC/index_ops.html" ops-console/app/index.html
cp -f "$SRC/updates_fe.js" frontend/updates.js
cp -f "$SRC/updates_ops.js" ops-console/app/updates.js
cp -f "$SRC/CHANGELOG_TG.md" CHANGELOG_TG.md
if [[ -f "$SRC/_deploy_guard.sh" ]]; then
  cp -f "$SRC/_deploy_guard.sh" backend/scripts/_deploy_guard.sh
  sed -i 's/\r$//' backend/scripts/_deploy_guard.sh
fi

grep -q 'updates.js?v=289' frontend/index.html
grep -q 'аудит' frontend/updates.js
grep -q '## 0mw\.' CHANGELOG_TG.md
grep -q '_smoke_0ms.js' backend/scripts/_hard_audit_full_0ht.js

(
  export OPENAI_API_KEY=sk-test
  export AUDIT_SMOKE=1
  node backend/scripts/_smoke_0mw.js
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
echo DEPLOY_0mw_OK
