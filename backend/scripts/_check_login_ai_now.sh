#!/bin/bash
# Scrub: no hardcoded login proxy secrets — read first socks5 from config/proxies-login.txt
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
cd "$B"
LINE=$(grep -m1 '^socks5' config/proxies-login.txt || true)
if [ -z "$LINE" ]; then echo "NO_LOGIN_PROXY_FILE"; exit 0; fi
# socks5:host:port:user:pass
HOST=$(echo "$LINE" | cut -d: -f2)
PORT=$(echo "$LINE" | cut -d: -f3)
USER=$(echo "$LINE" | cut -d: -f4)
PASS=$(echo "$LINE" | cut -d: -f5-)
echo "=== PM2 ==="
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];pl=[x for x in (e.get("PROXY_LIST")or"").split(";") if x.strip()];print({"status":e["status"],"PROXY_LEN":len(pl)})'
echo "=== LOGIN FILE ==="
echo "login_lines=$(grep -c '^socks5' config/proxies-login.txt || true)"
echo "=== LOGIN SOCKS REACH ==="
timeout 5 bash -c "echo > /dev/tcp/${HOST}/${PORT}" && echo "tcp_${HOST}:${PORT}=OK" || echo "tcp_${HOST}:${PORT}=FAIL"
echo "=== LOGIN POOL SMOKE ==="
HOST="$HOST" PORT="$PORT" USER="$USER" PASS="$PASS" node - <<'NODE' || true
const { SocksClient } = require('socks');
(async () => {
  const t0 = Date.now();
  try {
    const info = await SocksClient.createConnection({
      proxy: { host: process.env.HOST, port: +process.env.PORT, type: 5, userId: process.env.USER, password: process.env.PASS },
      command: 'connect',
      destination: { host: '149.154.167.50', port: 443 },
      timeout: 8000,
    });
    info.socket.destroy();
    console.log('login_socks_to_tg=OK', Date.now()-t0+'ms');
  } catch (e) {
    console.log('login_socks_to_tg=FAIL', e.message, Date.now()-t0+'ms');
  }
})();
NODE
