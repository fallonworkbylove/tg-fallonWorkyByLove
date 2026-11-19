#!/bin/bash
set -e
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if m: print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
mysql -h"$DB_HOST" -P"${DB_PORT:-3306}" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < /tmp/_tmp_alkh.sql
