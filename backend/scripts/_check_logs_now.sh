#!/bin/bash
set -euo pipefail
echo "=== NOW $(TZ=Europe/Moscow date) ==="
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e.get("status"),"restarts":e.get("restart_time"),"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()])})'
echo "=== ERR last 30 ==="
tail -n 30 /root/.pm2/logs/tgbot-error.log
echo "=== recent signals ==="
grep -aE 'Ответ для|Server is running|Warm TG|long polling|SESSION_WATCH|fetch failed|SocksClientError' \
  /root/.pm2/logs/tgbot-out.log /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -30
echo "=== TG API ==="
curl -sS -o /dev/null -w "api.telegram.org:%{http_code} t=%{time_total}\n" --connect-timeout 8 https://api.telegram.org/ \
  || echo "api.telegram.org FAIL"
curl -sS -o /dev/null -w "google:%{http_code}\n" --connect-timeout 5 https://www.google.com/ || echo google_FAIL
echo "=== counts in current err ==="
python3 - <<'PY'
from collections import Counter
err=open('/root/.pm2/logs/tgbot-error.log',encoding='utf-8',errors='replace').read().splitlines()
out=open('/root/.pm2/logs/tgbot-out.log',encoding='utf-8',errors='replace').read().splitlines()
c=Counter()
for l in err:
    if 'long polling' in l: c['long_poll']+=1
    elif 'SocksClient' in l or 'invalid Socks5' in l: c['socks']+=1
    elif 'SESSION_WATCH' in l: c['session_watch']+=1
    elif 'fetch failed' in l: c['fetch_failed']+=1
print(dict(c))
print('out_replies', sum(1 for l in out if 'Ответ для' in l))
print('out_last', out[-3:] if out else [])
print('err_last_nonstack')
for l in err:
    if l.startswith('[') or l.startswith('SocksClient'):
        last=l
print(last[-160:] if err else None)
# last long poll streak
import re
st=[int(m.group(1)) for l in err for m in [re.search(r'long polling \(×(\d+)', l)] if m]
print('longpoll_last_streak', st[-1] if st else None, 'max', max(st) if st else None)
PY
