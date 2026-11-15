#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
timeout 40 node scripts/_smoke_no_hello_substance_0jt.js
grep -q 'fixBareGreetingOnSubstance' services/aiResponderPostprocess.js
grep -q 'Не здоровается вместо ответа' ../frontend/updates.js
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST")or""; print({"status":p["pm2_env"]["status"],"PROXY":len([x for x in pl.split(";") if x.strip()])})'
echo AUDIT_A_0JT_OK
