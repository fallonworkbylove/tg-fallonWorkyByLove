#!/bin/bash
# 0gx: serve OPS web at /ops/ + changelog
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/0gx}
echo "=== deploy 0gx OPS web from $SRC ==="

mkdir -p "$BASE/ops-console/app"
for f in index.html styles.css renderer.js adminPanel.js updates.js i18n.js ops-web-bridge.js; do
  [ -f "$SRC/$f" ] && cp -a "$SRC/$f" "$BASE/ops-console/app/"
done
[ -f "$SRC/frontend_updates.js" ] && cp -a "$SRC/frontend_updates.js" "$BASE/frontend/updates.js"
[ -f "$SRC/frontend_index.html" ] && cp -a "$SRC/frontend_index.html" "$BASE/frontend/index.html"
[ -f "$SRC/CHANGELOG_TG.md" ] && cp -a "$SRC/CHANGELOG_TG.md" "$BASE/"

# nginx /ops/
NGINX=/etc/nginx/sites-enabled/tgbot
if ! grep -q 'location /ops/' "$NGINX" 2>/dev/null; then
  python3 - <<'PY'
from pathlib import Path
p = Path('/etc/nginx/sites-enabled/tgbot')
t = p.read_text(encoding='utf-8')
block = '''
    location = /ops {
        return 301 /ops/;
    }
    location /ops/ {
        alias /root/opt/tgbot/tg-miniapp-loverussian/ops-console/app/;
        add_header Cache-Control "no-cache";
        try_files $uri $uri/ =404;
    }
'''
needle = '    location /api/ {'
if 'location /ops/' in t:
    print('nginx_ops_already')
else:
    if needle not in t:
        raise SystemExit('nginx needle missing')
    t = t.replace(needle, block + '\n' + needle, 1)
    p.write_text(t, encoding='utf-8')
    print('nginx_ops_inserted')
PY
  nginx -t
  systemctl reload nginx
  echo nginx_reloaded
else
  echo nginx_ops_exists
  nginx -t && systemctl reload nginx || true
fi

# smoke: local file
test -f "$BASE/ops-console/app/ops-web-bridge.js"
test -f "$BASE/ops-console/app/index.html"
grep -q 'ops-web-bridge' "$BASE/ops-console/app/index.html"

curl -fsS -o /dev/null -w 'HTTP_OPS_INDEX=%{http_code}\n' https://loverussian.duckdns.org/ops/ || true
curl -fsS -o /dev/null -w 'HTTP_OPS_BRIDGE=%{http_code}\n' https://loverussian.duckdns.org/ops/ops-web-bridge.js || true

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
grep -n 'updates.js?v=' "$BASE/frontend/index.html" | head -1
grep -n 'OPS на телефон' "$BASE/frontend/updates.js" | head -1 || true
echo DEPLOY_0GX_OK
