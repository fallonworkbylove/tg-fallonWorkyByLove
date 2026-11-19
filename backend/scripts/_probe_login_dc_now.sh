#!/bin/bash
# Probe login DC via existing proxies-login.txt (or regenerate from env).
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

if [ -n "${LOGIN_PROXY_USER:-}" ] && [ -n "${LOGIN_PROXY_PASS:-}" ]; then
  HOST=${LOGIN_PROXY_HOST:-46.4.139.124}
  FROM=${LOGIN_PROXY_PORT_FROM:-10000}
  TO=${LOGIN_PROXY_PORT_TO:-10049}
  USER_STICKY="$LOGIN_PROXY_USER"
  case "$USER_STICKY" in *__sessttl.*) ;; *) USER_STICKY="${USER_STICKY}__sessttl.60" ;; esac
  cp -a config/proxies-login.txt "config/proxies-login.txt.bak.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
  {
    echo "# residential login sticky — generated $(date -u +%Y-%m-%dT%H:%MZ)"
    for port in $(seq "$FROM" "$TO"); do
      echo "socks5://${USER_STICKY}:${LOGIN_PROXY_PASS}@${HOST}:${port}"
    done
  } > config/proxies-login.txt
fi

LINE=$(grep -m1 '^socks5' config/proxies-login.txt || true)
if [ -z "$LINE" ]; then
  echo "NO_LOGIN_PROXY — set LOGIN_PROXY_USER/PASS or fill config/proxies-login.txt"
  exit 1
fi
# socks5://user:pass@host:port
export LOGIN_PROXY_USER=$(echo "$LINE" | sed -n 's#^socks5://\([^:]*\):.*#\1#p')
export LOGIN_PROXY_PASS=$(echo "$LINE" | sed -n 's#^socks5://[^:]*:\([^@]*\)@.*#\1#p')
export LOGIN_PROXY_HOST=$(echo "$LINE" | sed -n 's#.*@\([^:]*\):[0-9]*$#\1#p')

node - <<'NODE'
const { SocksClient } = require('socks');
const ports = [10000, 10017, 10033, 10049];
const dests = [
  ['149.154.167.50', 443],
  ['149.154.167.51', 443],
  ['91.108.56.165', 443],
  ['api.telegram.org', 443],
];
function via(proxy, host, port, ms) {
  return SocksClient.createConnection({
    proxy, command: 'connect', destination: { host, port }, timeout: ms,
  }).then((i) => { i.socket.destroy(); return 'OK'; });
}
(async () => {
  const baseHost = process.env.LOGIN_PROXY_HOST || '';
  const baseUser = process.env.LOGIN_PROXY_USER || '';
  const basePass = process.env.LOGIN_PROXY_PASS || '';
  if (!baseHost || !baseUser) {
    console.error('SET LOGIN_PROXY_HOST/USER/PASS from proxies-login.txt');
    process.exit(1);
  }
  let dcOk = 0, apiOk = 0, fail = 0;
  for (const port of ports) {
    const proxy = {
      host: baseHost, port, type: 5,
      userId: baseUser,
      password: basePass,
    };
    for (const [host, dport] of dests) {
      const t0 = Date.now();
      try {
        await via(proxy, host, dport, 10000);
        const kind = host.startsWith('api.') ? 'API' : 'DC';
        if (kind === 'API') apiOk++; else dcOk++;
        console.log('OK', kind, 'p'+port, host, Date.now()-t0+'ms');
      } catch (e) {
        fail++;
        console.log('FAIL', 'p'+port, host, e.message.slice(0,60), Date.now()-t0+'ms');
      }
    }
  }
  console.log(JSON.stringify({ dcOk, apiOk, fail, verdict: dcOk > 0 ? 'LOGIN_DC_OK' : 'LOGIN_DC_STILL_DEAD' }));
})();
NODE
