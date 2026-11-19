#!/bin/bash
# Separate OPS origin: ops-loverussian.duckdns.org
set -euo pipefail

OPS_HOST=ops-loverussian.duckdns.org
APP=/root/opt/tgbot/tg-miniapp-loverussian
OPS_ROOT="$APP/ops-console/app"
NGINX_AVAIL=/etc/nginx/sites-available/ops-loverussian
NGINX_EN=/etc/nginx/sites-enabled/ops-loverussian

DUCK_TOKEN=""
for f in /root/.duckdns/ops-loverussian.token /root/.duckdns/token /root/.duckdns/loverussian.token; do
  if [ -f "$f" ]; then DUCK_TOKEN=$(tr -d ' \n\r' <"$f"); break; fi
done
if [ -z "$DUCK_TOKEN" ] && grep -qE '^DUCKDNS_TOKEN=' "$APP/backend/.env" 2>/dev/null; then
  DUCK_TOKEN=$(grep -E '^DUCKDNS_TOKEN=' "$APP/backend/.env" | head -1 | cut -d= -f2- | tr -d "\"' \n\r")
fi

IP=$(curl -4 -s --max-time 8 ifconfig.me || true)
if [ -n "${DUCK_TOKEN:-}" ] && [ -n "${IP:-}" ]; then
  echo "duckdns update ops-loverussian → $IP"
  curl -sS --max-time 15 \
    "https://www.duckdns.org/update?domains=ops-loverussian&token=${DUCK_TOKEN}&ip=${IP}" || true
  echo
  sleep 2
else
  echo "WARN: no DuckDNS token — $OPS_HOST must already point to $IP"
fi

cat > "$NGINX_AVAIL" <<EOF
server {
    listen 80;
    server_name $OPS_HOST;
    root $OPS_ROOT;
    index index.html;
    client_max_body_size 5m;
    location / {
        add_header Cache-Control "no-cache";
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
ln -sfn "$NGINX_AVAIL" "$NGINX_EN"
nginx -t
systemctl reload nginx

if [ ! -d "/etc/letsencrypt/live/$OPS_HOST" ]; then
  certbot --nginx -d "$OPS_HOST" --non-interactive --agree-tos \
    --register-unsafely-without-email --redirect \
    && echo CERT_OK || echo CERTBOT_FAIL
else
  echo "cert ok $OPS_HOST"
fi

python3 - <<'PY'
import re
from pathlib import Path
p = Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/.env')
t = p.read_text(encoding='utf-8', errors='ignore')
want = ['https://ops-loverussian.duckdns.org', 'https://loverussian.duckdns.org']
m = re.search(r'^CORS_ORIGIN=(.*)$', t, re.M)
parts = []
if m:
    parts = [x.strip() for x in m.group(1).strip().strip('"').strip("'").split(',') if x.strip()]
for w in want:
    if w not in parts:
        parts.append(w)
val = ','.join(parts)
if m:
    t2 = re.sub(r'^CORS_ORIGIN=.*$', 'CORS_ORIGIN=' + val, t, count=1, flags=re.M)
else:
    t2 = t.rstrip() + '\nCORS_ORIGIN=' + val + '\n'
p.write_text(t2, encoding='utf-8')
print('CORS_ORIGIN', val)
PY

# Do NOT redirect main /ops/ until DNS for OPS_HOST resolves.
if getent hosts "$OPS_HOST" >/dev/null 2>&1; then
  echo "DNS ok for $OPS_HOST — enable redirect later manually if desired"
else
  echo "DNS missing for $OPS_HOST — keep serving https://loverussian.duckdns.org/ops/"
fi

nginx -t && systemctl reload nginx
echo SETUP_OPS_ORIGIN_DONE
# HTTP vhost may still answer by IP/Host header for future DNS
curl -sI --max-time 8 -H "Host: $OPS_HOST" http://127.0.0.1/ | head -5 || true
curl -sI --max-time 8 https://loverussian.duckdns.org/ops/ | head -5 || true
