#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo "=== post-add C verify 0js ==="
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
timeout 40 node scripts/_smoke_hard_c_0js.js
timeout 40 node scripts/_hard_audit_0ht.js
timeout 40 node scripts/_hard_audit_0gt.js
# new errors after restart only
grep -aE 'voice is not defined' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -3 || true
# check recent out after pid start
PID=$(pm2 pid tgbot)
START=$(ps -p "$PID" -o lstart=)
echo "pid=$PID started=$START"
grep -aE 'voice is not defined|Отложенный ответ для|Не удалось отправить отложенный' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -15 || true
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST")or""; print({"status":p["pm2_env"]["status"],"PROXY":len([x for x in pl.split(";") if x.strip()])})'
echo POST_C_0JS_OK
