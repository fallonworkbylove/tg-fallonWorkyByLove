#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0kh}
echo "=== deploy 0kh Syne/Manrope fonts ==="

cp -a "$SRC/frontend_styles.css" "$BASE/frontend/styles.css"
cp -a "$SRC/frontend_app.js" "$BASE/frontend/app.js"
cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
mkdir -p "$BASE/ops-console/app"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
cp -a "$SRC/_smoke_fonts_0kh.js" "$BASE/backend/scripts/_smoke_fonts_0kh.js"
cp -a "$SRC/_smoke_screen_bugs_0jz.js" "$BASE/backend/scripts/_smoke_screen_bugs_0jz.js"

grep -q 'Manrope' "$BASE/frontend/styles.css"
grep -q 'Syne' "$BASE/frontend/styles.css"
! grep -q 'Space Grotesk' "$BASE/frontend/styles.css"
grep -q 'family=Manrope' "$BASE/frontend/index.html"
grep -q 'family=Syne' "$BASE/frontend/index.html"
! grep -qE 'Space\+Grotesk|DM\+Sans' "$BASE/frontend/index.html"
grep -q 'styles.css?v=87' "$BASE/frontend/index.html"
grep -q 'updates.js?v=213' "$BASE/frontend/index.html"
grep -q 'app.js?v=176' "$BASE/frontend/index.html"
grep -q 'Вернули прежний шрифт' "$BASE/frontend/updates.js"
grep -q 'Manrope,system-ui' "$BASE/frontend/app.js"

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

node scripts/_smoke_fonts_0kh.js

# frontend-only: no pm2 restart needed for static files, but keep proxy gate live
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
grep -q 'updates.js?v=213' "$BASE/frontend/index.html"
grep -q 'Вернули прежний шрифт' "$BASE/frontend/updates.js"
echo DONE_0kh
