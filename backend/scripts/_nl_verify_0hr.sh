#!/bin/bash
grep -n 'olderMin = 28\|ложных' \
  /root/opt/tgbot/tg-miniapp-loverussian/backend/services/opsQuality.js \
  /root/opt/tgbot/tg-miniapp-loverussian/frontend/updates.js \
  /root/opt/tgbot/tg-miniapp-loverussian/ops-console/app/updates.js | head -10
grep -oE 'updates.js\?v=[0-9]+' /root/opt/tgbot/tg-miniapp-loverussian/frontend/index.html | head -1
python3 <<'PY'
import json
from subprocess import check_output
j=json.loads(check_output(['pm2','jlist'],text=True))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
pl=e.get('PROXY_LIST') or ''
print('pm2', e.get('status'), 'PROXY', len([x for x in pl.split(';') if x.strip()]))
PY
grep -aE 'Занята|AI silence alert|Ответ для akstazi|Ответ для OnlyFans' /root/.pm2/logs/tgbot-out.log | tail -12
