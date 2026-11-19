#!/bin/bash
# Writes sticky login pool from env — never hardcode user/pass in git.
# Required: LOGIN_PROXY_USER LOGIN_PROXY_PASS
# Optional: LOGIN_PROXY_HOST (default 46.4.139.124), LOGIN_PROXY_PORT_FROM/TO
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
cd "$B"
CFG=config/proxies-login.txt
: "${LOGIN_PROXY_USER:?set LOGIN_PROXY_USER}"
: "${LOGIN_PROXY_PASS:?set LOGIN_PROXY_PASS}"
HOST=${LOGIN_PROXY_HOST:-46.4.139.124}
FROM=${LOGIN_PROXY_PORT_FROM:-10000}
TO=${LOGIN_PROXY_PORT_TO:-10049}
USER_STICKY="$LOGIN_PROXY_USER"
case "$USER_STICKY" in
  *__sessttl.*) ;;
  *) USER_STICKY="${USER_STICKY}__sessttl.60" ;;
esac

cp -a "$CFG" "config/proxies-login.txt.bak.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
{
  echo "# residential login sticky — generated $(date -u +%Y-%m-%dT%H:%MZ)"
  for port in $(seq "$FROM" "$TO"); do
    echo "socks5://${USER_STICKY}:${LOGIN_PROXY_PASS}@${HOST}:${port}"
  done
} > "$CFG"

echo "written=$(grep -c '^socks5' "$CFG")"
export LOGIN_PROXY_HOST="$HOST"
export LOGIN_PROXY_USER="$USER_STICKY"
export LOGIN_PROXY_PASS

node - <<'NODE'
const { parseProxyEntry } = require('./services/proxyPools');
const fs = require('fs');
const lines = fs.readFileSync('config/proxies-login.txt','utf8').split(/\n/).filter(l=>l&&!l.startsWith('#'));
const p = parseProxyEntry(lines[0]);
if (!p || !String(p.username).includes('sessttl')) {
  console.error('PARSE_FAIL', p); process.exit(1);
}
console.log('PARSE_OK', { n: lines.length, user: p.username, port: p.port });
NODE

echo "=== DC PROBE (3 ports) ==="
node - <<'NODE'
const { SocksClient } = require('socks');
const ports = [10000, 10025, 10049];
const dests = [
  ['149.154.167.50', 443],
  ['91.108.56.165', 443],
  ['api.telegram.org', 443],
];
(async () => {
  const baseHost = process.env.LOGIN_PROXY_HOST || '';
  const baseUser = process.env.LOGIN_PROXY_USER || '';
  const basePass = process.env.LOGIN_PROXY_PASS || '';
  if (!baseHost || !baseUser) {
    console.error('SET LOGIN_PROXY_HOST/USER/PASS');
    process.exit(1);
  }
  for (const port of ports) {
    const proxy = {
      host: baseHost, port, type: 5,
      userId: baseUser,
      password: basePass,
    };
    for (const [host, dport] of dests) {
      const t0 = Date.now();
      try {
        const info = await SocksClient.createConnection({
          proxy, command: 'connect', destination: { host, port: dport }, timeout: 12000,
        });
        info.socket.destroy();
        console.log('OK', 'p'+port, host, Date.now()-t0+'ms');
      } catch (e) {
        console.log('FAIL', 'p'+port, host, e.message.slice(0,70), Date.now()-t0+'ms');
      }
    }
  }
})();
NODE
echo DONE_sticky
