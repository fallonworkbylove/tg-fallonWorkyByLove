#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cp -f /tmp/0lv/aiResponder.js "$BASE/backend/services/aiResponder.js"
grep -q '12 \* 60 \* 1000' "$BASE/backend/services/aiResponder.js"
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text = Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/.env').read_text(encoding='utf-8', errors='ignore')
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
sleep 7
bash "$BASE/backend/scripts/_deploy_guard.sh"
curl -sS -m 8 http://127.0.0.1:3000/api/health; echo
echo HOT_0lv_OK
