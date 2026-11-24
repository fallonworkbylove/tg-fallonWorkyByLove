#!/bin/bash
set -euo pipefail
SRC=${1:-/tmp/0t1}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

cp -f "$SRC/aiResponder.js" backend/services/aiResponder.js
cp -f "$SRC/finetuneUsage.js" backend/services/finetuneUsage.js
cp -f "$SRC/peerProfile.js" backend/services/peerProfile.js
cp -f "$SRC/learningDb.js" backend/services/learningDb.js
cp -f "$SRC/helpRequestNotifier.js" backend/services/helpRequestNotifier.js
cp -f "$SRC/adminMenu.js" backend/services/adminMenu.js
cp -f "$SRC/_smoke_0t1.js" backend/scripts/_smoke_0t1.js
cp -f "$SRC/CHANGELOG_TG.md" CHANGELOG_TG.md

grep -q 'pickChatModel' backend/services/aiResponder.js
grep -q 'openai/gpt-5.6-luna' backend/services/finetuneUsage.js
grep -q 'getAnalysisModel' backend/services/peerProfile.js
grep -q '## 0t1\.' CHANGELOG_TG.md

(
  export OPENAI_API_KEY=sk-test
  export AUDIT_SMOKE=1
  node backend/scripts/_smoke_0t1.js
)

# Env must already have OpenRouter key + models (patched before deploy).
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text = Path('backend/.env').read_text(encoding='utf-8', errors='ignore')
for key in [
    'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'OPENAI_MODEL_LIGHT',
    'OPENAI_MODEL_COMPLEX', 'OPENAI_MODEL_FALLBACK', 'OPENAI_FALLBACK_KEY',
    'PROXY_LIST', 'OPENAI_PROXY_LIST', 'CORS_ORIGIN',
]:
    m = re.search(rf'^{re.escape(key)}=(.*)$', text, re.M)
    if m:
        print('export %s=%s' % (key, shlex.quote(m.group(1).strip())))
PY
)"
unset AUDIT_SMOKE || true
case "${OPENAI_API_KEY:-}" in
  ''|sk-deploy*|sk-audit*|sk-test*) echo REFUSE_OPENAI_FAKE; exit 1;;
esac
case "${OPENAI_BASE_URL:-}" in
  *openrouter.ai*) ;;
  *) echo REFUSE_BASE_URL_NOT_OPENROUTER; exit 1;;
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
sleep 14
bash backend/scripts/_deploy_guard.sh
echo DEPLOY_0t1_OK
