#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
cd "$B"
LINE=$(grep -m1 '^socks5' config/proxies-login.txt || true)
if [ -z "$LINE" ]; then echo "NO_LOGIN_PROXY_FILE"; exit 0; fi
HOST=$(echo "$LINE" | cut -d: -f2)
PORT=$(echo "$LINE" | cut -d: -f3)
USER=$(echo "$LINE" | cut -d: -f4)
PASS=$(echo "$LINE" | cut -d: -f5-)
echo "login_proxy_host=$HOST port=$PORT"
HOST="$HOST" PORT="$PORT" USER="$USER" PASS="$PASS" node - <<'NODE' || true
const { SocksClient } = require('socks');
(async () => {
  try {
    const info = await SocksClient.createConnection({
      proxy: {
        host: process.env.HOST,
        port: +process.env.PORT,
        type: 5,
        userId: process.env.USER,
        password: process.env.PASS,
      },
      command: 'connect',
      destination: { host: '149.154.167.50', port: 443 },
      timeout: 8000,
    });
    info.socket.destroy();
    console.log('login_socks_to_tg=OK');
  } catch (e) {
    console.log('login_socks_to_tg=FAIL', e.message);
  }
})();
NODE
