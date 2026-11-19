#!/bin/bash
set -euo pipefail
grep -oE 'updates.js\?v=[0-9]+' /root/opt/tgbot/tg-miniapp-loverussian/frontend/index.html | head -1
grep -n '0ho\|Европе' /root/opt/tgbot/tg-miniapp-loverussian/CHANGELOG_TG.md /root/opt/tgbot/tg-miniapp-loverussian/frontend/updates.js | head -6
python3 - <<'PY'
import json,re
from pathlib import Path
from subprocess import check_output
j=json.loads(check_output(['pm2','jlist'],text=True))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
pl=(e.get('PROXY_LIST') or '')
print({'status':e.get('status'),'PROXY':len([x for x in pl.split(';') if x.strip()])})
login=Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/config/proxies-login.txt').read_text(encoding='utf-8',errors='ignore')
print('login_lines', sum(1 for l in login.splitlines() if l.strip() and not l.startswith('#')))
PY
grep -aE 'Work \(DC\)|Login \(residential\)|Server is running' /root/.pm2/logs/tgbot-out.log | tail -8
grep -a 'Ответ для' /root/.pm2/logs/tgbot-out.log | tail -3
