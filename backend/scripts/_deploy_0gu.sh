#!/bin/bash
# 0gu: dead-proxy re-probe cron (07:00 / 19:00 MSK) + notebooks sync
set -euo pipefail
TAG=0gu
APP=/root/opt/tgbot/tg-miniapp-loverussian
B="$APP/backend"
SRC=${1:-/tmp/0gu}
echo "=== deploy $TAG from $SRC ==="

cp -f "$SRC/_reprobe_dead_proxies.js" "$B/scripts/"
cp -f "$SRC/_reprobe_dead_proxies.sh" "$B/scripts/"
chmod +x "$B/scripts/_reprobe_dead_proxies.sh"
cp -f "$SRC/updates.js" "$APP/frontend/updates.js"
cp -f "$SRC/index.html" "$APP/frontend/index.html"
if [ -f "$SRC/ops_updates.js" ]; then
  mkdir -p "$APP/ops-console/app"
  cp -f "$SRC/ops_updates.js" "$APP/ops-console/app/updates.js"
fi
if [ -f "$SRC/CHANGELOG_TG.md" ]; then
  cp -f "$SRC/CHANGELOG_TG.md" "$APP/CHANGELOG_TG.md"
fi

# cron: 04:00 and 16:00 UTC = 07:00 and 19:00 MSK
CRON_LINE='0 4,16 * * * /bin/bash /root/opt/tgbot/tg-miniapp-loverussian/backend/scripts/_reprobe_dead_proxies.sh'
tmpdir=$(mktemp)
crontab -l 2>/dev/null | grep -v '_reprobe_dead_proxies' >"$tmpdir" || true
echo "$CRON_LINE" >>"$tmpdir"
crontab "$tmpdir"
rm -f "$tmpdir"
echo "CRON_INSTALLED:"
crontab -l | grep reprobe || true

# keep PROXY alive — no forced restart unless env broken
cd "$B"
python3 - <<'PY'
import re, json
from pathlib import Path
from subprocess import check_output
t=Path('.env').read_text(encoding='utf-8', errors='ignore')
m=re.search(r'^PROXY_LIST=(.*)$', t, re.M)
pl=(m.group(1).strip() if m else '')
n=len([x for x in pl.split(';') if x.strip()])
print('env_PROXY_LEN', n)
if n < 5:
    raise SystemExit('REFUSE: PROXY_LEN < 5')
j=json.loads(check_output(['pm2','jlist'], text=True))
p=[x for x in j if x['name']=='tgbot'][0]
pl2=p['pm2_env'].get('PROXY_LIST') or ''
print({'status':p['pm2_env']['status'],'pm2_PROXY_LEN':len([x for x in pl2.split(';') if x.strip()])})
PY

# smoke: node syntax
node --check "$B/scripts/_reprobe_dead_proxies.js"
echo "SMOKE_OK syntax"
grep -n 'updates.js?v=' "$APP/frontend/index.html" | head -1
grep -n 'Мёртвые прокси' "$APP/frontend/updates.js" | head -1
echo "DONE $TAG"
