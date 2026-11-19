#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0ku}
echo "=== deploy 0ku brand splash colors ==="

cp -a "$SRC/frontend_styles.css" "$BASE/frontend/styles.css"
cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
mkdir -p "$BASE/ops-console/app"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

grep -q 'styles.css?v=100' "$BASE/frontend/index.html"
grep -q 'updates.js?v=226' "$BASE/frontend/index.html"
grep -q 'brand-mark__love' "$BASE/frontend/styles.css"
grep -q '#e8ffe0' "$BASE/frontend/styles.css"
grep -q 'd6ff9a' "$BASE/frontend/styles.css"
grep -q 'Название как на загрузке' "$BASE/frontend/updates.js"
! grep -q 'brand-mark__russian {\n  color: #8a9288' "$BASE/frontend/styles.css" || true
grep -A2 'brand-mark__love' "$BASE/frontend/styles.css" | grep -q '#e8ffe0'

cd "$BASE/backend"
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
echo DONE_0ku
