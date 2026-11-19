#!/bin/bash
# Run ON OLD VPS: dump DB + pack app (no huge node_modules if we npm ci on new)
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
OUT=/tmp/nl_migrate_$(date +%Y%m%d_%H%M)
mkdir -p "$OUT"
cd "$BASE/backend"
# dump using .env credentials
python3 - <<'PY'
import re, subprocess
from pathlib import Path
env=Path('.env').read_text(encoding='utf-8',errors='ignore')
g=lambda k,d='': (m.group(1).strip() if (m:=re.search(rf'^{re.escape(k)}=(.*)$',env,re.M)) else d)
host,user,pw,db,port=g('DB_HOST','127.0.0.1'),g('DB_USER'),g('DB_PASSWORD'),g('DB_NAME'),g('DB_PORT','3306')
out='/tmp/nl_migrate_db.sql'
# write to path from env OUT via shell after
open('/tmp/_db_dump_cmd.sh','w').write(f'''#!/bin/bash
set -euo pipefail
mysqldump -h {host} -P {port} -u {user} -p'{pw}' --single-transaction --routines --triggers {db} > "$1"
echo DUMP_OK bytes=$(wc -c < "$1")
''')
print(db, user, host)
PY
OUTDIR=$(ls -d /tmp/nl_migrate_* | tail -1)
bash /tmp/_db_dump_cmd.sh "$OUTDIR/db.sql"
# pack app without node_modules and heavy caches
cd /root/opt/tgbot
tar --exclude='tg-miniapp-loverussian/backend/node_modules' \
    --exclude='tg-miniapp-loverussian/**/node_modules' \
    --exclude='tg-miniapp-loverussian/**/.git' \
    --exclude='tg-miniapp-loverussian/**/*.log' \
    -czf "$OUTDIR/app.tgz" tg-miniapp-loverussian
# also sessions if outside
ls -lah "$OUTDIR"
echo "MIGRATE_OUT=$OUTDIR"
