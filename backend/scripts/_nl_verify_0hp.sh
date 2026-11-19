#!/bin/bash
grep -oE 'updates.js\?v=[0-9]+' /root/opt/tgbot/tg-miniapp-loverussian/frontend/index.html | head -1
grep -n '0hp\|пятидесяти' /root/opt/tgbot/tg-miniapp-loverussian/CHANGELOG_TG.md /root/opt/tgbot/tg-miniapp-loverussian/frontend/updates.js | head -6
python3 <<'PY'
import json
from pathlib import Path
from subprocess import check_output
j=json.loads(check_output(['pm2','jlist'],text=True))
p=[x for x in j if x['name']=='tgbot'][0]
pl=p['pm2_env'].get('PROXY_LIST') or ''
print('status', p['pm2_env'].get('status'), 'PROXY', len([x for x in pl.split(';') if x.strip()]))
login=Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/config/proxies-login.txt').read_text(encoding='utf-8',errors='ignore')
print('login', sum(1 for l in login.splitlines() if l.strip() and not l.startswith('#')))
PY
grep -aE 'Login \(residential\) пул: 50|Server is running' /root/.pm2/logs/tgbot-out.log | tail -4
