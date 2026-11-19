#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
cd "$B"

USER=70743bc405758b1c
PASS=cLzvHBR2p4T3a8r0
HOST=res.proxy-seller.com

echo "=== RESOLVE ==="
getent hosts "$HOST" | head -3 || host "$HOST" | head -3 || true

echo "=== DC PROBE (3 ports) ==="
node - <<NODE
const { SocksClient } = require('socks');
const dns = require('dns').promises;
const host = '$HOST';
const user = '$USER';
const pass = '$PASS';
const ports = [10000, 10010, 10019];
const dests = [
  ['149.154.167.50', 443],
  ['91.108.56.165', 443],
  ['api.telegram.org', 443],
];
(async () => {
  let resolved;
  try { resolved = (await dns.lookup(host)).address; console.log('dns', host, '->', resolved); }
  catch (e) { console.log('dns_fail', e.message); }
  let dcOk = 0, apiOk = 0, fail = 0;
  for (const port of ports) {
    const proxy = { host, port, type: 5, userId: user, password: pass };
    for (const [dhost, dport] of dests) {
      const t0 = Date.now();
      try {
        const info = await SocksClient.createConnection({
          proxy, command: 'connect', destination: { host: dhost, port: dport }, timeout: 12000,
        });
        info.socket.destroy();
        const kind = dhost.startsWith('api.') ? 'API' : 'DC';
        if (kind === 'API') apiOk++; else dcOk++;
        console.log('OK', kind, 'p'+port, dhost, Date.now()-t0+'ms');
      } catch (e) {
        fail++;
        console.log('FAIL', 'p'+port, dhost, e.message.slice(0,80), Date.now()-t0+'ms');
      }
    }
  }
  const verdict = dcOk > 0 ? 'LOGIN_DC_OK' : 'LOGIN_DC_STILL_DEAD';
  console.log(JSON.stringify({ dcOk, apiOk, fail, verdict }));
  require('fs').writeFileSync('/tmp/ps_verdict.txt', verdict);
})();
NODE

VERDICT=$(cat /tmp/ps_verdict.txt)
echo "verdict=$VERDICT"

# always install — user asked to try; keep in pool
CFG=config/proxies-login.txt
cp -a "$CFG" "config/proxies-login.txt.bak.$(date +%Y%m%d_%H%M%S)"
{
  echo "# proxy-seller sticky try — $(date -u +%Y-%m-%dT%H:%MZ) verdict=$VERDICT"
  for p in $(seq 10000 10019); do
    echo "socks5://${USER}:${PASS}@${HOST}:${p}"
  done
} > "$CFG"
echo "written=$(grep -c '^socks5' "$CFG")"

node - <<'NODE'
const { parseProxyEntry } = require('./services/proxyPools');
const fs = require('fs');
const lines = fs.readFileSync('config/proxies-login.txt','utf8').split(/\n/).filter(l=>l&&!l.startsWith('#'));
const p = parseProxyEntry(lines[0]);
if (!p || !p.ip || !p.port) { console.error('PARSE_FAIL', p); process.exit(1); }
console.log('PARSE_OK', { n: lines.length, host: p.ip, port: p.port, user: p.username });
NODE

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
export TELEGRAM_AUTH_BYPASS=false TELEGRAM_AUTH_BYPASS_FORCE=false
n=$(echo "${PROXY_LIST:-}" | tr ';' '\n' | grep -c socks5 || true)
echo "work_PROXY_LEN=$n"
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

pm2 restart tgbot --update-env
pm2 save
sleep 8
grep -a 'Login (residential)' /root/.pm2/logs/tgbot-out.log | tail -1 | cut -c1-180
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e["status"],"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()])})'
echo PROXY_SELLER_DONE
