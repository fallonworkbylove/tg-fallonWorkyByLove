#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
curl -sS http://127.0.0.1:3000/api/health; echo
echo "tg sockets: $(ss -tnp 2>/dev/null | grep -cE '149\.154\.|91\.108\.' || true)"
echo '--- recent AUTH ---'
grep -aE 'Аккаунт (3|8|23|24|27|29|30|31|35|36):' /root/.pm2/logs/tgbot-error.log | tail -20
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
for k in ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT']:
    m=re.search(rf'^{k}=(.*)$',t,re.M)
    if m: print('export %s=%s'%(k, shlex.quote(m.group(1).strip())))
PY
)"
mysql -h"$DB_HOST" -P"${DB_PORT:-3306}" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -N -e \
  "SELECT id, phone, status, IF(session_string IS NULL OR session_string='',0,1) has_sess
   FROM accounts WHERE id IN (3,8,23,24,27,29,30,31,35,36) ORDER BY id;"
