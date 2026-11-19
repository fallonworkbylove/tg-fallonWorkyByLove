#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
OUT=/tmp/nl_migrate
rm -rf "$OUT"
mkdir -p "$OUT"
cd "$BASE/backend"
python3 - <<'PY'
import re
from pathlib import Path
env=Path('.env').read_text(encoding='utf-8',errors='ignore')
g=lambda k,d='': (m.group(1).strip() if (m:=re.search(rf'^{re.escape(k)}=(.*)$',env,re.M)) else d)
host,user,pw,db,port=g('DB_HOST','127.0.0.1'),g('DB_USER'),g('DB_PASSWORD'),g('DB_NAME'),g('DB_PORT','3306')
Path('/tmp/_mysqldump.sh').write_text(
f"""#!/bin/bash
set -euo pipefail
mysqldump -h {host} -P {port} -u {user} -p'{pw}' --single-transaction --routines --triggers --set-gtid-purged=OFF {db} > /tmp/nl_migrate/db.sql
echo DUMP_BYTES=$(wc -c </tmp/nl_migrate/db.sql)
""", encoding='utf-8')
print('db', db)
PY
bash /tmp/_mysqldump.sh
# copy env separately (secrets)
cp -a "$BASE/backend/.env" "$OUT/backend.env"
# pack app without node_modules
cd /root/opt/tgbot
tar --exclude='tg-miniapp-loverussian/backend/node_modules' \
    --exclude='tg-miniapp-loverussian/**/node_modules' \
    --exclude='tg-miniapp-loverussian/**/.git' \
    --exclude='tg-miniapp-loverussian/**/*.log' \
    -czf "$OUT/app.tgz" tg-miniapp-loverussian
ls -lah "$OUT"
echo MIGRATE_READY
