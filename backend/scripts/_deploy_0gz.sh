#!/bin/bash
# 0gz: OPS phone cards fit screen (no horizontal overflow)
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0gz}
echo "=== deploy 0gz OPS phone overflow fix from $SRC ==="

mkdir -p "$BASE/ops-console/app"
for f in index.html styles.css renderer.js adminPanel.js updates.js i18n.js ops-web-bridge.js; do
  [ -f "$SRC/$f" ] && cp -a "$SRC/$f" "$BASE/ops-console/app/" && echo "ops:$f"
done
[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/frontend_index.html" ] && cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

grep -q 'styles.css?v=130' "$BASE/ops-console/app/index.html"
grep -q 'ничего не уезжает вбок' "$BASE/ops-console/app/styles.css"
grep -q 'Карточки OPS больше не вылезают' "$BASE/frontend/updates.js"
grep -q 'updates.js?v=130' "$BASE/frontend/index.html"

curl -fsS -o /dev/null -w 'HTTP_OPS_CSS=%{http_code}\n' "https://loverussian.duckdns.org/ops/styles.css?v=130" || true

cd "$BASE/backend"
python3 - <<'PY'
import re, json
from pathlib import Path
from subprocess import check_output
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^PROXY_LIST=(.*)$',t,re.M)
pl=(m.group(1).strip() if m else '')
n=len([x for x in pl.split(';') if x.strip()])
print('env_PROXY_LEN', n)
j=json.loads(check_output(['pm2','jlist'], text=True))
p=[x for x in j if x['name']=='tgbot'][0]
print({'status':p['pm2_env']['status'],'pm2_PROXY_LEN':len([x for x in (p['pm2_env'].get('PROXY_LIST') or '').split(';') if x.strip()])})
if n < 5:
    raise SystemExit('REFUSE_PROXY')
PY

echo DEPLOY_0GZ_OK
