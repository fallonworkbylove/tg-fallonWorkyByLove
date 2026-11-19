#!/bin/bash
set -euo pipefail
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n})
PY
curl -sS http://127.0.0.1:3000/api/health; echo
echo '---ERR---'
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY|AUTH_KEY_DUPLICATED' /root/.pm2/logs/tgbot-error.log | tail -15 || true
echo '---OUT---'
grep -aE 'AI замолчал|outbound |отсев' /root/.pm2/logs/tgbot-out.log | tail -15 || true
grep -q 'Живее короткие ответы' /root/opt/tgbot/tg-miniapp-loverussian/frontend/updates.js && echo 'updates_ok'
grep -oE 'updates.js\?v=[0-9]+' /root/opt/tgbot/tg-miniapp-loverussian/frontend/index.html
