#!/bin/bash
# Restore TG-capable PROXY_LIST; keep purged OPENAI_PROXY_LIST from 0hf.
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

WORK='socks5:104.164.205.112:63647:66uC85M2ZJU5:xyFuQApb5NgB;socks5:138.249.212.178:63683:66uC85M2ZJU5:xyFuQApb5NgB;socks5:45.139.54.158:63513:66uC85M2ZJU5:xyFuQApb5NgB;socks5:193.201.127.216:63401:66uC85M2ZJU5:xyFuQApb5NgB;socks5:104.164.209.27:62913:66uC85M2ZJU5:xyFuQApb5NgB;socks5:168.80.83.53:8000:BfNHVZ:rZJ9Cn;socks5:196.18.14.240:8000:nFBMNd:QEntaw;socks5:192.166.153.231:8000:nFBMNd:QEntaw;socks5:168.80.83.236:8000:BfNHVZ:rZJ9Cn'

if [ ! -f /tmp/purge0hf_OPENAI_PROXY_LIST.txt ]; then
  echo 'missing /tmp/purge0hf_OPENAI_PROXY_LIST.txt'
  exit 1
fi
OA=$(cat /tmp/purge0hf_OPENAI_PROXY_LIST.txt)

python3 - <<PY
import re
from pathlib import Path
work = '''$WORK'''
oa = Path('/tmp/purge0hf_OPENAI_PROXY_LIST.txt').read_text(encoding='utf-8').strip()
p = Path('.env')
t = p.read_text(encoding='utf-8', errors='ignore')

def set_key(text, key, val):
    if re.search(rf'^{key}=', text, re.M):
        return re.sub(rf'^{key}=.*$', f'{key}={val}', text, count=1, flags=re.M)
    return text.rstrip() + f'\n{key}={val}\n'

t2 = set_key(t, 'PROXY_LIST', work)
t2 = set_key(t2, 'OPENAI_PROXY_LIST', oa)
p.write_text(t2, encoding='utf-8')
print('PROXY_LEN', work.count('socks5:'))
print('OPENAI_LEN', oa.count('socks5:'))
PY

export PROXY_LIST="$WORK"
export OPENAI_PROXY_LIST="$OA"
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
t = Path('.env').read_text(encoding='utf-8', errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','BOT_TOKEN','PORT','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME']:
    m = re.search(rf'^{key}=(.*)$', t, re.M)
    if m:
        print(f'export {key}={shlex.quote(m.group(1).strip())}')
PY
)"

n=$(echo "$PROXY_LIST" | tr ';' '\n' | grep -c socks5 || true)
echo "shell_PROXY=$n"
[ "$n" -ge 5 ] || { echo REFUSE; exit 1; }

pm2 restart tgbot --update-env
pm2 save
sleep 8
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e["status"],"pm2_PROXY_LEN":len([x for x in (e.get("PROXY_LIST")or"").split(";") if x.strip()]),"pm2_OPENAI_LEN":len([x for x in (e.get("OPENAI_PROXY_LIST")or"").split(";") if x.strip()])})'
grep -aE 'Warm TG:|Work \(DC\)' /root/.pm2/logs/tgbot-out.log | tail -4
echo RESTORE_TG_WORK_OK
