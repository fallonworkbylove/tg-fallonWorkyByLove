#!/bin/bash
set -euo pipefail
# nginx cannot read /root by default — open path or relocate
chmod 755 /root
chmod -R o+rX /root/opt/tgbot/tg-miniapp-loverussian/frontend
chmod -R o+rX /root/opt/tgbot/tg-miniapp-loverussian/ops-console/app
# better nginx config matching old proxy_pass style
cat >/etc/nginx/sites-available/loverussian <<'NGX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name loverussian.duckdns.org 31.57.143.31 _;
    client_max_body_size 25m;

    root /root/opt/tgbot/tg-miniapp-loverussian/frontend;
    index index.html;

    location = /ops { return 301 /ops/; }
    location /ops/ {
        alias /root/opt/tgbot/tg-miniapp-loverussian/ops-console/app/;
        add_header Cache-Control "no-cache";
        try_files $uri $uri/ =404;
    }

    location /api/ {
        proxy_connect_timeout 180s;
        proxy_send_timeout 180s;
        proxy_read_timeout 180s;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /media/ {
        proxy_pass http://127.0.0.1:3000/media/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /index.html {
        add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0";
        try_files $uri =404;
    }

    location / {
        add_header Cache-Control "no-cache";
        try_files $uri $uri/ /index.html;
    }
}
NGX
nginx -t
systemctl reload nginx
curl -sS -o /dev/null -w "nginx_root:%{http_code}\n" http://127.0.0.1/
curl -sS -o /dev/null -w "nginx_ops:%{http_code}\n" http://127.0.0.1/ops/
curl -sS -o /dev/null -w "nginx_api:%{http_code}\n" http://127.0.0.1/api/accounts
# pm2 status + recent out
sleep 3
pm2 status
tail -n 30 /root/.pm2/logs/tgbot-out.log || true
echo FIX_OK
