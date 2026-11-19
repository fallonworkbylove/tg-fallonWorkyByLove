#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
pkill -f '_nightly_hard_audit|_post_0hj_fix' 2>/dev/null || true

grep -n 'MEDIA_ASK_RE' services/silenceCatchup.js | head -4
grep -q 'пересматриваю' services/silenceCatchup.js && echo BAD_loose || echo OK_tight_comment

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','BOT_TOKEN','PORT','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','CORS_ORIGIN','ADMIN_CONSOLE_TOKEN']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
export TELEGRAM_AUTH_BYPASS=false
export TELEGRAM_AUTH_BYPASS_FORCE=false
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo PROXY_LEN=$n
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

pm2 restart tgbot --update-env
pm2 save
sleep 8
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e["status"],"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()]),"BYPASS":e.get("TELEGRAM_AUTH_BYPASS"),"FORCE":e.get("TELEGRAM_AUTH_BYPASS_FORCE")})'
echo HOTFIX_OK
