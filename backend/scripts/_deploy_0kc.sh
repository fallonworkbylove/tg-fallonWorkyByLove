#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0kc}
echo "=== deploy 0kc connect form ==="

[ -f "$SRC/frontend_styles.css" ] && cp -a "$SRC/frontend_styles.css" "$BASE/frontend/styles.css"
[ -f "$SRC/frontend_index.html" ] && cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/frontend_app.js" ] && cp -a "$SRC/frontend_app.js" "$BASE/frontend/app.js"
[ -f "$SRC/ops_updates.js" ] && mkdir -p "$BASE/ops-console/app" && cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

grep -q 'connect-card__kicker' "$BASE/frontend/styles.css"
grep -q 'connect-card' "$BASE/frontend/index.html"
grep -q 'Подключение аккаунта стало спокойнее' "$BASE/frontend/updates.js"
grep -q 'styles.css?v=82' "$BASE/frontend/index.html"
grep -q 'updates.js?v=208' "$BASE/frontend/index.html"
! grep -q 'f9a8d4\|7c3aed\|d946ef' "$BASE/frontend/styles.css"

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
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
assert e['status']=='online' and n>=5
PY
curl -sS http://127.0.0.1:3000/api/health; echo
echo DONE_0kc
