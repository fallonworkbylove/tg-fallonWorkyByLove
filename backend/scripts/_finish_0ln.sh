#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
unset AUDIT_SMOKE || true
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^PROXY_LIST=(.*)$',text,re.M)
if m: print('export PROXY_LIST=%s'%shlex.quote(m.group(1).strip()))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }
unset AUDIT_SMOKE || true
pm2 restart tgbot --update-env
pm2 save
sleep 4
bash scripts/_deploy_guard.sh
echo DONE_0ln
