#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','OPENAI_API_KEY','PROXY_LIST','BOT_TOKEN','NODE_ENV','TELEGRAM_AUTH_BYPASS','TELEGRAM_AUTH_BYPASS_FORCE','LISTEN_HOST','CORS_ORIGIN','ADMIN_CONSOLE_TOKEN']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
node scripts/_ultra_hard_audit.js
echo ULTRA_EXIT=$?
# security gates
python3 - <<'PY'
import re
from pathlib import Path
t=Path('.env').read_text(errors='replace')
print('NODE_ENV', re.search(r'^NODE_ENV=(.*)$',t,re.M).group(1) if re.search(r'^NODE_ENV=',t,re.M) else 'missing')
print('BYPASS', re.search(r'^TELEGRAM_AUTH_BYPASS=(.*)$',t,re.M).group(1) if re.search(r'^TELEGRAM_AUTH_BYPASS=',t,re.M) else 'missing')
print('BYPASS_FORCE', re.search(r'^TELEGRAM_AUTH_BYPASS_FORCE=(.*)$',t,re.M).group(1) if re.search(r'^TELEGRAM_AUTH_BYPASS_FORCE=',t,re.M) else 'missing')
print('LISTEN', re.search(r'^LISTEN_HOST=(.*)$',t,re.M).group(1) if re.search(r'^LISTEN_HOST=',t,re.M) else 'missing')
pl=re.search(r'^PROXY_LIST=(.*)$',t,re.M)
n=len([x for x in (pl.group(1).strip() if pl else '').split(';') if x.strip()])
print('PROXY_LEN', n)
PY
curl -s http://127.0.0.1:3000/api/health; echo
