#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node scripts/_hard_audit_0gt.js
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
pl=p['pm2_env'].get('PROXY_LIST') or ''
print({'status':p['pm2_env']['status'],'PROXY':len([x for x in pl.split(';') if x.strip()])})
PY
echo VOICE_ERR_TAIL
grep -aF 'voice is not defined' /root/.pm2/logs/tgbot-out.log | tail -3 || true
echo REENGAGE_TAIL
grep -aE 'Отложенный ответ для|Не удалось отправить отложенный' /root/.pm2/logs/tgbot-out.log | tail -8 || true
echo VERIFY_0JS_OK
