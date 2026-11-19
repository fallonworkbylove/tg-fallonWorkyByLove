#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
cp -a /tmp/silenceCatchup.js "$B/services/silenceCatchup.js"
cd "$B"
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
t = Path('.env').read_text(encoding='utf-8', errors='ignore')
for k in ['PROXY_LIST','OPENAI_PROXY_LIST','OPENAI_API_KEY','BOT_TOKEN','PORT','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','CORS_ORIGIN']:
    m = re.search(rf'^{k}=(.*)$', t, re.M)
    if m:
        print(f'export {k}={shlex.quote(m.group(1).strip())}')
PY
)"
n=$(echo "$PROXY_LIST" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || exit 1
pm2 restart tgbot --update-env
pm2 save
sleep 10
grep -aE 'silence\+heal|Incorrect arguments' /root/.pm2/logs/tgbot-out.log /root/.pm2/logs/tgbot-error.log | tail -8
echo HOT_SILENCE_OK
