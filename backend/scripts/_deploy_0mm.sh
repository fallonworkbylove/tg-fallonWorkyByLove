#!/bin/bash
set -euo pipefail
SRC=${1:-/tmp/0mm}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

sed -i 's/\r$//' "$SRC"/*.sh 2>/dev/null || true

cp -f "$SRC/softHumanGates.js" backend/services/softHumanGates.js
cp -f "$SRC/_smoke_0mm.js" backend/scripts/_smoke_0mm.js
cp -f "$SRC/index_frontend.html" frontend/index.html
cp -f "$SRC/index_ops.html" ops-console/app/index.html
cp -f "$SRC/updates_fe.js" frontend/updates.js
cp -f "$SRC/updates_ops.js" ops-console/app/updates.js
cp -f "$SRC/CHANGELOG_TG.md" CHANGELOG_TG.md
if [[ -f "$SRC/_deploy_guard.sh" ]]; then
  cp -f "$SRC/_deploy_guard.sh" backend/scripts/_deploy_guard.sh
  sed -i 's/\r$//' backend/scripts/_deploy_guard.sh
fi

# выкинуть мёртвый socks из .env (ECONNREFUSED в логах)
python3 - <<'PY'
from pathlib import Path
import re
p = Path('backend/.env')
t = p.read_text(encoding='utf-8', errors='ignore')
m = re.search(r'^(PROXY_LIST=)(.*)$', t, re.M)
if not m:
    raise SystemExit(0)
dead = '192.166.153.231'
parts = [x.strip() for x in m.group(2).split(';') if x.strip() and dead not in x]
new = m.group(1) + ';'.join(parts)
t2 = t[:m.start()] + new + t[m.end():]
if t2 != t:
    p.write_text(t2, encoding='utf-8')
    print('PROXY_SCRUB', dead, 'left', len(parts))
else:
    print('PROXY_SCRUB_NONE', len(parts))
PY

pkill -f 'backend/scripts/_smoke_' 2>/dev/null || true
sleep 1

grep -q 'updates.js?v=279' frontend/index.html
grep -q 'курени' frontend/updates.js
grep -q '## 0mm\.' CHANGELOG_TG.md
grep -q 'fixSmokingSoftYes' backend/services/softHumanGates.js

(
  export OPENAI_API_KEY=sk-test
  export AUDIT_SMOKE=1
  node backend/scripts/_smoke_0mm.js
)

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text = Path('backend/.env').read_text(encoding='utf-8', errors='ignore')
for key in ['OPENAI_API_KEY', 'PROXY_LIST', 'OPENAI_PROXY_LIST', 'CORS_ORIGIN']:
    m = re.search(rf'^{re.escape(key)}=(.*)$', text, re.M)
    if m:
        print('export %s=%s' % (key, shlex.quote(m.group(1).strip())))
PY
)"
unset AUDIT_SMOKE || true
case "${OPENAI_API_KEY:-}" in
  ''|sk-deploy*|sk-audit*|sk-test*) echo REFUSE_OPENAI_FAKE; exit 1;;
esac
n=$(python3 - <<'PY'
import os
print(len([x for x in os.environ.get('PROXY_LIST','').split(';') if x.strip()]))
PY
)
echo "PROXY_LEN=$n"
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

pm2 restart tgbot --update-env
pm2 save
sleep 12
bash backend/scripts/_deploy_guard.sh
echo DEPLOY_0mm_OK
