#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/0lu
cp -f "$SRC/aiResponder.js" "$BASE/backend/services/aiResponder.js"
cp -f "$SRC/_smoke_conn_error_failover_0lu.js" "$BASE/backend/scripts/_smoke_conn_error_failover_0lu.js"

(
  cd "$BASE/backend"
  export AUDIT_SMOKE=1
  export OPENAI_API_KEY=sk-deploy
  export PROXY_LIST='socks5:1.1.1.1:8000:u:p;socks5:2.2.2.2:8000:u:p;socks5:3.3.3.3:8000:u:p'
  node scripts/_smoke_conn_error_failover_0lu.js
)

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
sleep 8
bash /tmp/0lu/_verify_0lu_live.sh
bash "$BASE/backend/scripts/_deploy_guard.sh"
echo PATCH_0lu_OK
