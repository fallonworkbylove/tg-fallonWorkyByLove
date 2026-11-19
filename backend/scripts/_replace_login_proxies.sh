#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
cd "$B"
CFG=config/proxies-login.txt
: "${LOGIN_PROXY_USER:?set LOGIN_PROXY_USER}"
: "${LOGIN_PROXY_PASS:?set LOGIN_PROXY_PASS}"
HOST=${LOGIN_PROXY_HOST:-46.4.139.124}
PORT=${LOGIN_PROXY_PORT:-824}
cp -a "$CFG" "config/proxies-login.txt.bak.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
LINE="socks5://${LOGIN_PROXY_USER}:${LOGIN_PROXY_PASS}@${HOST}:${PORT}"
{
  echo "# residential login — replaced $(date -u +%Y-%m-%dT%H:%MZ)"
  for i in $(seq 1 50); do echo "$LINE"; done
} > "$CFG"
echo "written=$(grep -c '^socks5' "$CFG" || true)"
head -1 "$CFG" | sed 's/:[^:@]*@/:***@/'
