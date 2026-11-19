#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0kr}
echo "=== deploy 0kr acid green stripes shades ==="

cp -a "$SRC/frontend_styles.css" "$BASE/frontend/styles.css"
cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
mkdir -p "$BASE/ops-console/app"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
cp -a "$SRC/_smoke_stripe_green_0kr.js" "$BASE/backend/scripts/_smoke_stripe_green_0kr.js"

grep -q 'styles.css?v=97' "$BASE/frontend/index.html"
grep -q 'updates.js?v=223' "$BASE/frontend/index.html"
grep -q 'border-left-color: #9fd84a' "$BASE/frontend/styles.css"
grep -q 'border-left-color: #d4ff6e' "$BASE/frontend/styles.css"
grep -q 'border-left-color: #b8ff3c' "$BASE/frontend/styles.css"
! grep -q '7eb8e8' "$BASE/frontend/styles.css"
! grep -q '126, 184, 232' "$BASE/frontend/styles.css"
grep -q 'Зелёные полоски в ленте' "$BASE/frontend/updates.js"

cd "$BASE/backend"
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
keys=['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','MYSQL_HOST','MYSQL_USER','MYSQL_PASSWORD','MYSQL_DATABASE','MYSQL_PORT']
for key in keys:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

node scripts/_smoke_stripe_green_0kr.js

# Проверка на проде: media/lead не через var(--primary)
! grep -n 'is-media' "$BASE/frontend/styles.css" | head -5
grep -n 'border-left-color: #d4ff6e' "$BASE/frontend/styles.css"
grep -n 'border-left-color: #9fd84a' "$BASE/frontend/styles.css"

pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
e=[x for x in j if x['name']=='tgbot'][0]['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
assert e['status']=='online' and n>=5
PY
curl -sS http://127.0.0.1:3000/api/health; echo
echo DONE_0kr
