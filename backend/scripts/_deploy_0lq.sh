#!/bin/bash
# Deploy 0lq — audit C UX fixes
set -euo pipefail
TAG=0lq
SRC=${1:-/tmp/0lq}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

cp -f "$SRC/leadScoring.js" backend/services/leadScoring.js
cp -f "$SRC/_smoke_audit_c_fix_0lq.js" backend/scripts/_smoke_audit_c_fix_0lq.js
cp -f "$SRC/renderer.js" ops-console/app/renderer.js
cp -f "$SRC/app.js" frontend/app.js
cp -f "$SRC/updates_fe.js" frontend/updates.js
cp -f "$SRC/updates_ops.js" ops-console/app/updates.js
cp -f "$SRC/index_fe.html" frontend/index.html
cp -f "$SRC/index_ops.html" ops-console/app/index.html
cp -f "$SRC/CHANGELOG_TG.md" CHANGELOG_TG.md

# Smoke only — never leave fake OPENAI in shell before pm2 --update-env
(
  export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-deploy}"
  node backend/scripts/_smoke_audit_c_fix_0lq.js
  node backend/scripts/_smoke_funnel_days_0ln.js
)

# Restore real secrets from .env into this shell for pm2 --update-env
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text = Path('backend/.env').read_text(encoding='utf-8', errors='ignore')
keys = ['OPENAI_API_KEY', 'PROXY_LIST', 'OPENAI_PROXY_LIST']
for key in keys:
    m = re.search(rf'^{re.escape(key)}=(.*)$', text, re.M)
    if not m:
        continue
    print('export %s=%s' % (key, shlex.quote(m.group(1).strip())))
PY
)"
unset AUDIT_SMOKE || true
[ -n "${OPENAI_API_KEY:-}" ] || { echo REFUSE_OPENAI_MISSING; exit 1; }
case "$OPENAI_API_KEY" in sk-deploy*|sk-audit*|sk-test*) echo REFUSE_OPENAI_FAKE; exit 1;; esac

pm2 restart tgbot --update-env
pm2 save
sleep 4
bash backend/scripts/_deploy_guard.sh

grep -q 'updates.js?v=247' frontend/index.html
grep -q 'Чище карточки лидов' frontend/updates.js
grep -q 'Чище карточки лидов' ops-console/app/updates.js
grep -q '## 0lq\.' CHANGELOG_TG.md
grep -q cleanBoardSnippet backend/services/leadScoring.js
grep -q renderEmptyBoard ops-console/app/renderer.js

echo "DEPLOY_0lq_OK"
