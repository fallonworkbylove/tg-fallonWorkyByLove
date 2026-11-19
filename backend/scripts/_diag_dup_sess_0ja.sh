#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo '=== processes ==='
ps aux | grep -E 'node|gram' | grep -v grep
echo '=== duplicate session_string? ==='
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if m: print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
mysql -h"$DB_HOST" -P"${DB_PORT:-3306}" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -N -e "
SELECT COUNT(*) AS total,
  SUM(session_string IS NOT NULL AND session_string!='') AS with_sess
FROM accounts;
SELECT session_string, COUNT(*) c, GROUP_CONCAT(id) ids
FROM accounts
WHERE session_string IS NOT NULL AND session_string!=''
GROUP BY session_string
HAVING c>1
LIMIT 20;
SELECT id, phone, status, LEFT(session_string,12) pref, CHAR_LENGTH(session_string) len
FROM accounts
WHERE session_string IS NOT NULL AND session_string!=''
ORDER BY id;
"
echo '=== health ==='
curl -sS http://127.0.0.1:3000/api/health; echo
echo '=== shutdown log ==='
grep -aE 'shutdown|отключено сессий' /root/.pm2/logs/tgbot-out.log | tail -15
