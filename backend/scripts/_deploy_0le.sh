#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0le}
echo "=== deploy 0le deploy guard ==="

cp -a "$SRC/aiResponder.js" "$BASE/backend/services/aiResponder.js"
cp -a "$SRC/server.js" "$BASE/backend/server.js"
cp -a "$SRC/_deploy_guard.sh" "$BASE/backend/scripts/_deploy_guard.sh"
cp -a "$SRC/_smoke_deploy_guard_0le.js" "$BASE/backend/scripts/_smoke_deploy_guard_0le.js"
cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
cp -a "$SRC/index.html" "$BASE/frontend/index.html"
mkdir -p "$BASE/ops-console/app"
cp -a "$SRC/ops_updates.js" "$BASE/ops-console/app/updates.js"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"
mkdir -p "$BASE/.cursor/skills/loverussian-deploy"
cp -a "$SRC/loverussian-deploy-SKILL.md" "$BASE/.cursor/skills/loverussian-deploy/SKILL.md"

grep -q 'openai_ready' "$BASE/backend/server.js"
grep -q 'isOpenAiClientReady' "$BASE/backend/services/aiResponder.js"
grep -q 'DEPLOY_GUARD_OK' "$BASE/backend/scripts/_deploy_guard.sh"
grep -q 'updates.js?v=236' "$BASE/frontend/index.html"
grep -q 'Защита после выката' "$BASE/frontend/updates.js"
grep -q '## 0le\.' "$BASE/CHANGELOG_TG.md"
grep -q '_deploy_guard.sh' "$BASE/.cursor/skills/loverussian-deploy/SKILL.md"

cd "$BASE/backend"
AUDIT_SMOKE=1 node scripts/_smoke_deploy_guard_0le.js
unset AUDIT_SMOKE || true

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

unset AUDIT_SMOKE || true
pm2 restart tgbot --update-env
pm2 save
sleep 3
sed -i 's/\r$//' scripts/_deploy_guard.sh
bash scripts/_deploy_guard.sh
echo DONE_0le
