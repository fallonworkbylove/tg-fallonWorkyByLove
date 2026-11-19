#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE/backend"

# Prefer direct TG on NL: keep PROXY if present but don't refuse empty
# Soft-trim: leave env as migrated; probe Bot API first after start

# nginx site — HTTP for now (cert after DNS)
cat >/etc/nginx/sites-available/loverussian <<'NGX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name loverussian.duckdns.org 31.57.143.31 _;
    client_max_body_size 50m;

    root /root/opt/tgbot/tg-miniapp-loverussian/frontend;
    index index.html;

    location /ops/ {
        alias /root/opt/tgbot/tg-miniapp-loverussian/ops-console/app/;
        try_files $uri $uri/ /ops/index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    location / {
        try_files $uri $uri/ /index.html;
        # also proxy non-file backend routes if needed
    }

    # backend static/media if any
    location /media/ {
        proxy_pass http://127.0.0.1:3000/media/;
        proxy_set_header Host $host;
    }
}
NGX
ln -sfn /etc/nginx/sites-available/loverussian /etc/nginx/sites-enabled/loverussian
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# export env for pm2
set -a
# shellcheck disable=SC1091
source <(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/.env').read_text(encoding='utf-8',errors='ignore')
keys=['OPENAI_API_KEY','PROXY_LIST','OPENAI_PROXY_LIST','BOT_TOKEN','PORT','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','DB_PORT','CORS_ORIGIN','ADMIN_CONSOLE_TOKEN','TELEGRAM_AUTH_BYPASS','TELEGRAM_AUTH_BYPASS_FORCE','TELEGRAM_API_ID','TELEGRAM_API_HASH','ADMIN_ALERT_CHAT_ID']
for key in keys:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print(f'export {key}={shlex.quote(m.group(1).strip())}')
PY
)
set +a
export TELEGRAM_AUTH_BYPASS=false TELEGRAM_AUTH_BYPASS_FORCE=false
export PORT="${PORT:-3000}"
export DB_HOST=127.0.0.1

# On NL: try WITHOUT work proxies for sessions (direct DC worked)
# Keep a backup and clear PROXY_LIST for first boot test
cp -a .env .env.bak_pre_nl
python3 - <<'PY'
from pathlib import Path
import re
p=Path('.env')
t=p.read_text(encoding='utf-8',errors='replace')
# comment old proxy into backup line
if re.search(r'^PROXY_LIST=',t,re.M):
    t=re.sub(r'^PROXY_LIST=.*$','PROXY_LIST=',t,count=1,flags=re.M)
if re.search(r'^OPENAI_PROXY_LIST=',t,re.M):
    t=re.sub(r'^OPENAI_PROXY_LIST=.*$','OPENAI_PROXY_LIST=',t,count=1,flags=re.M)
# CORS allow both
if re.search(r'^CORS_ORIGIN=',t,re.M):
    t=re.sub(r'^CORS_ORIGIN=.*$','CORS_ORIGIN=*',t,count=1,flags=re.M)
else:
    t+='\nCORS_ORIGIN=*\n'
p.write_text(t,encoding='utf-8')
print('PROXY cleared for NL direct')
PY
export PROXY_LIST=
export OPENAI_PROXY_LIST=

pm2 delete tgbot >/dev/null 2>&1 || true
pm2 start server.js --name tgbot --update-env
pm2 save
pm2 startup systemd -u root --hp /root | tail -5
sleep 8
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e.get("status"),"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()])})'

echo "=== Bot API getMe ==="
python3 - <<'PY'
import re, urllib.request
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^BOT_TOKEN=(.*)$',t,re.M)
tok=(m.group(1).strip() if m else '')
url=f'https://api.telegram.org/bot{tok}/getMe'
with urllib.request.urlopen(url, timeout=15) as r:
    print(r.status, r.read()[:200])
PY

curl -sS -o /dev/null -w "local3000:%{http_code}\n" --connect-timeout 5 http://127.0.0.1:3000/ || true
curl -sS -o /dev/null -w "nginx80:%{http_code}\n" --connect-timeout 5 http://127.0.0.1/ || true
echo START_OK
