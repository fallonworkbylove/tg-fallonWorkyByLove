#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0lc}
echo "=== deploy 0lc planned miniapp motion ==="

cp -a "$SRC/styles.css" "$BASE/frontend/styles.css"
cp -a "$SRC/index.html" "$BASE/frontend/index.html"
cp -a "$SRC/app.js" "$BASE/frontend/app.js"
cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
mkdir -p "$BASE/ops-console/app"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
cp -a "$SRC/_smoke_motion_0lc.js" "$BASE/backend/scripts/_smoke_motion_0lc.js"

grep -q 'styles.css?v=105' "$BASE/frontend/index.html"
grep -q 'app.js?v=184' "$BASE/frontend/index.html"
grep -q 'updates.js?v=234' "$BASE/frontend/index.html"
grep -q 'nav-indicator' "$BASE/frontend/index.html"
grep -q 'syncNavIndicator' "$BASE/frontend/app.js"
grep -q 'Анимации по всему приложению' "$BASE/frontend/updates.js"
grep -q '## 0lc\.' "$BASE/CHANGELOG_TG.md"

cd "$BASE/backend"
node scripts/_smoke_motion_0lc.js

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^PROXY_LIST=(.*)$',text,re.M)
if m: print('export PROXY_LIST=%s'%shlex.quote(m.group(1).strip()))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

pm2 restart tgbot --update-env
pm2 save
sleep 2
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
echo DONE_0lc
