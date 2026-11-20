#!/bin/bash
set -euo pipefail
SRC=${1:-/tmp/0m7}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

cp -f "$SRC/finetuneUsage.js" backend/services/finetuneUsage.js
cp -f "$SRC/adminConsoleStats.js" backend/services/adminConsoleStats.js
cp -f "$SRC/aiResponder.js" backend/services/aiResponder.js
cp -f "$SRC/app.js" frontend/app.js
cp -f "$SRC/styles.css" frontend/styles.css
cp -f "$SRC/index_frontend.html" frontend/index.html
cp -f "$SRC/updates_fe.js" frontend/updates.js
cp -f "$SRC/updates_ops.js" ops-console/app/updates.js
cp -f "$SRC/CHANGELOG_TG.md" CHANGELOG_TG.md
cp -f "$SRC/_smoke_admin_usage_0m7.js" backend/scripts/_smoke_admin_usage_0m7.js
cp -f "$SRC/_hard_audit_0m7.js" backend/scripts/_hard_audit_0m7.js

if grep -q 'операторская, вне Telegram' frontend/index.html; then
  echo REFUSE_FRONTEND_IS_OPS
  exit 1
fi
grep -q 'updates.js?v=264' frontend/index.html
grep -q 'app.js?v=189' frontend/index.html
grep -q 'styles.css?v=114' frontend/index.html
grep -q '## 0m7\.' CHANGELOG_TG.md
grep -q 'getAccountCostMap' backend/services/finetuneUsage.js
grep -q 'formatAdminReplyAge' frontend/app.js
grep -q 'accountId: options.accountId' backend/services/aiResponder.js

(
  export OPENAI_API_KEY=sk-test
  unset AUDIT_SMOKE || true
  node backend/scripts/_smoke_admin_usage_0m7.js
  node backend/scripts/_hard_audit_0m7.js
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
echo DEPLOY_0m7_OK
