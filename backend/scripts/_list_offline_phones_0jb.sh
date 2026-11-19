#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
curl -sS http://127.0.0.1:3000/api/health; echo
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
for k in ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT']:
    m=re.search(rf'^{k}=(.*)$',t,re.M)
    if m: print('export %s=%s'%(k, shlex.quote(m.group(1).strip())))
PY
)"
# offline = has session but failed bootstrap recently, OR no session
# use known fail ids + any with session where we can't know isActive from SQL
# Print all with session; mark the known offline set
mysql -h"$DB_HOST" -P"${DB_PORT:-3306}" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -N -e "
SELECT id, phone, status,
  IF(session_string IS NULL OR session_string='', 'NO_SESS', 'HAS_SESS')
FROM accounts
WHERE id IN (3,8,23,24,27,29,30,31,35,36)
ORDER BY id;
"
echo '--- all with session (for cross-check) ---'
mysql -h"$DB_HOST" -P"${DB_PORT:-3306}" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -N -e "
SELECT id, phone, status FROM accounts
WHERE session_string IS NOT NULL AND session_string != ''
ORDER BY id;
"
