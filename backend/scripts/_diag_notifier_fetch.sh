#!/bin/bash
set -euo pipefail
echo "=== pm2 ==="
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e.get("status"),"restarts":e.get("restart_time"),"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()])})'
echo "=== err notifier ==="
grep -aE 'helpRequestNotifier|long polling|fetch failed|setMyCommands' /root/.pm2/logs/tgbot-error.log | tail -25
echo "=== curl TG ==="
curl -sS -o /dev/null -w "api.telegram.org http=%{http_code} t=%{time_total}\n" --connect-timeout 10 https://api.telegram.org/ || echo CURL_TG_FAIL
echo "=== getMe via bot token (masked) ==="
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
python3 - <<'PY'
import re, urllib.request
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^BOT_TOKEN=(.*)$',t,re.M)
tok=(m.group(1).strip() if m else '')
print('BOT_TOKEN_set', bool(tok), 'len', len(tok))
if not tok:
    raise SystemExit
url=f'https://api.telegram.org/bot{tok}/getMe'
try:
    with urllib.request.urlopen(url, timeout=15) as r:
        body=r.read()[:200]
        print('getMe', r.status, body[:120])
except Exception as e:
    print('getMe_FAIL', type(e).__name__, e)
PY
