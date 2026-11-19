#!/bin/bash
set -euo pipefail
echo '=== wire ==='
grep -n markProxyDead /root/opt/tgbot/tg-miniapp-loverussian/backend/services/clientPool.js | head -5
grep -n 'timeout: 8' /root/opt/tgbot/tg-miniapp-loverussian/backend/services/proxyPools.js | head -5
grep -a 'Work (DC)' /root/.pm2/logs/tgbot-out.log | tail -1
echo '=== out ==='
grep -aE 'DEAD|сразу|подключ|Ответ для|не удалось подключ' /root/.pm2/logs/tgbot-out.log | tail -40
echo '=== err hosts ==='
python3 - <<'PY'
import re
t=open('/root/.pm2/logs/tgbot-error.log','rb').read().decode('utf-8','replace')
hosts=re.findall(r"host: '([^']+)'", t[-12000:])
print('recent_hosts', hosts[-12:])
PY
echo CHECK_0GM_LIVE_DONE
