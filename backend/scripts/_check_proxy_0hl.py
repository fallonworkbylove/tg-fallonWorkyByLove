#!/usr/bin/env python3
import json, re, subprocess
from pathlib import Path
env = Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/.env').read_text(encoding='utf-8', errors='ignore')
m = re.search(r'^PROXY_LIST=(.*)$', env, re.M)
pl = (m.group(1).strip() if m else '')
print('env_PROXY_LEN', len([x for x in pl.split(';') if x.strip()]))
j = json.loads(subprocess.check_output(['pm2', 'jlist'], text=True))
p = next(x for x in j if x.get('name') == 'tgbot')
pml = p['pm2_env'].get('PROXY_LIST') or ''
print('status', p['pm2_env'].get('status'))
print('pm2_PROXY_LEN', len([x for x in pml.split(';') if x.strip()]))
