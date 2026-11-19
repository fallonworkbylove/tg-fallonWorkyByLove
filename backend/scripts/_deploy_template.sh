#!/bin/bash
# Шаблон деплоя: скопируй в _deploy_<TAG>.sh и заполни FILES / SMOKE / TITLE / VBUMP.
# Использование: bash _deploy_<TAG>.sh [/tmp/<TAG>]
set -euo pipefail
TAG="${TAG:-0gX}"
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=${1:-/tmp/$TAG}
TITLE_GREP="${TITLE_GREP:-}"
VBUMP="${VBUMP:-}"
SMOKE="${SMOKE:-}"

echo "=== deploy $TAG ==="
# Пример копирования (переопредели в конкретном скрипте):
# cp -a "$SRC/foo.js" "$BASE/backend/services/"

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

if [ -n "$SMOKE" ] && [ -f "scripts/$SMOKE" ]; then
  sed -i 's/\r$//' "scripts/$SMOKE" || true
  timeout 60 node "scripts/$SMOKE"
fi

if [ -n "$TITLE_GREP" ]; then
  grep -q "$TITLE_GREP" "$BASE/frontend/updates.js"
fi
if [ -n "$VBUMP" ]; then
  grep -q "updates.js?v=$VBUMP" "$BASE/frontend/index.html"
fi

pm2 stop tgbot
echo "waiting 95s..."
sleep 95
pm2 start tgbot --update-env
pm2 save
sleep 15
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
if e['status']!='online': raise SystemExit('tgbot not online')
if n < 5: raise SystemExit('REFUSE_PROXY pm2')
PY
curl -sS http://127.0.0.1:3000/api/health; echo
echo "DONE_$TAG"
