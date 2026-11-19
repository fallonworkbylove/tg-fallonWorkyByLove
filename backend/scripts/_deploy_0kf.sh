#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0kf}
echo "=== deploy 0kf splash ==="

[ -f "$SRC/frontend_styles.css" ] && cp -a "$SRC/frontend_styles.css" "$BASE/frontend/styles.css"
[ -f "$SRC/frontend_app.js" ] && cp -a "$SRC/frontend_app.js" "$BASE/frontend/app.js"
[ -f "$SRC/frontend_index.html" ] && cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/ops_updates.js" ] && mkdir -p "$BASE/ops-console/app" && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

grep -q 'app-splash' "$BASE/frontend/styles.css"
grep -q 'app-splash' "$BASE/frontend/index.html"
grep -q 'app-splash' "$BASE/frontend/app.js"
grep -q 'styles.css?v=85' "$BASE/frontend/index.html"
grep -q 'app.js?v=174' "$BASE/frontend/index.html"
grep -q 'updates.js?v=211' "$BASE/frontend/index.html"
grep -q 'Экран загрузки с логотипом' "$BASE/frontend/updates.js"

cd "$BASE/backend"
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }
pm2 describe tgbot >/dev/null
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
echo DONE_0kf
