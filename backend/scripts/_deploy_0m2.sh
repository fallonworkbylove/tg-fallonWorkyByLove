#!/bin/bash
set -euo pipefail
SRC=${1:-/tmp/0m2}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

cp -f "$SRC/learningDb.js" backend/services/learningDb.js
cp -f "$SRC/silenceCatchup.js" backend/services/silenceCatchup.js
cp -f "$SRC/replyPipeline.js" backend/services/replyPipeline.js
cp -f "$SRC/howLong.js" backend/services/howLong.js
cp -f "$SRC/_smoke_0m2.js" backend/scripts/_smoke_0m2.js
cp -f "$SRC/_scrub_cors_env.py" backend/scripts/_scrub_cors_env.py
cp -f "$SRC/index_frontend.html" frontend/index.html
cp -f "$SRC/index_ops.html" ops-console/app/index.html
cp -f "$SRC/updates_fe.js" frontend/updates.js
cp -f "$SRC/updates_ops.js" ops-console/app/updates.js
cp -f "$SRC/CHANGELOG_TG.md" CHANGELOG_TG.md
cp -f "$SRC/_deploy_guard.sh" backend/scripts/_deploy_guard.sh 2>/dev/null || true

if grep -q 'операторская, вне Telegram' frontend/index.html; then
  echo REFUSE_FRONTEND_IS_OPS
  exit 1
fi
grep -q 'updates.js?v=259' frontend/index.html
grep -q 'После сбоя сети догон быстрее' frontend/updates.js
grep -q '## 0m2\.' CHANGELOG_TG.md
grep -q 'noteTransportMiss' backend/services/silenceCatchup.js
grep -q 'noteTransportMiss' backend/services/replyPipeline.js

python3 backend/scripts/_scrub_cors_env.py backend/.env || true

(
  export OPENAI_API_KEY=sk-test
  node backend/scripts/_smoke_0m2.js
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
echo DEPLOY_0m2_OK
