#!/bin/bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
python3 - <<'PY'
import re, os
from pathlib import Path
t=Path('.env').read_text(errors='replace')
for k in ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT']:
 m=re.search(rf'^{re.escape(k)}=(.*)$',t,re.M)
 if m: os.environ[k]=m.group(1).strip()
PY
# load env into node via dotenv-less inline
node <<'NODE'
const fs=require('fs');
for (const line of fs.readFileSync('.env','utf8').split(/\n/)) {
  const m=line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]]=m[2].trim();
}
require('./scripts/_diag_auth_dup_0iw.js');
NODE
