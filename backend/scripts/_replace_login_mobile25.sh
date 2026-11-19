#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
cd "$B"
CFG=config/proxies-login.txt
cp -a "$CFG" "config/proxies-login.txt.bak.$(date +%Y%m%d_%H%M%S)"

# host:port:user:pass → socks5 URL
{
  echo "# login sticky30 — replaced $(date -u +%Y-%m-%dT%H:%MZ)"
  cat <<'RAW'
46.4.139.124:10000:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10001:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10002:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10003:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10004:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10005:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10006:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10007:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10008:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10009:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10010:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10011:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10012:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10013:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10014:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10015:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10016:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10017:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10018:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10019:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10020:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10021:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10022:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10023:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
46.4.139.124:10024:a7ca3affcdf10079f292__sessttl.30:ff9b2c85537396f2
RAW
} | awk -F: '
  /^#/ || NF==0 { print; next }
  NF>=4 {
    host=$1; port=$2; user=$3; pass=$4;
    for(i=5;i<=NF;i++) pass=pass ":" $i;
    printf "socks5://%s:%s@%s:%s\n", user, pass, host, port;
    next
  }
  { print }
' > "$CFG"

echo "written=$(grep -c '^socks5' "$CFG")"
node - <<'NODE'
const { parseProxyEntry } = require('./services/proxyPools');
const fs = require('fs');
const lines = fs.readFileSync('config/proxies-login.txt','utf8').split(/\n/).filter(l=>l&&!l.startsWith('#'));
const p = parseProxyEntry(lines[0]);
if (!p || p.ip !== '46.4.139.124' || Number(p.port) !== 10000 || !String(p.username).includes('sessttl.30')) {
  console.error('PARSE_FAIL', p); process.exit(1);
}
console.log('PARSE_OK', { n: lines.length, user: p.username, port0: p.port, portLast: parseProxyEntry(lines[lines.length-1]).port });
NODE

echo "=== DC PROBE ==="
node - <<'NODE'
const { SocksClient } = require('socks');
const user = 'a7ca3affcdf10079f292__sessttl.30';
const pass = 'ff9b2c85537396f2';
const ports = [10000, 10012, 10024];
const dests = [
  ['149.154.167.50', 443],
  ['91.108.56.165', 443],
  ['api.telegram.org', 443],
];
(async () => {
  let dcOk = 0, apiOk = 0, fail = 0;
  for (const port of ports) {
    const proxy = { host: '46.4.139.124', port, type: 5, userId: user, password: pass };
    for (const [host, dport] of dests) {
      const t0 = Date.now();
      try {
        const info = await SocksClient.createConnection({
          proxy, command: 'connect', destination: { host, port: dport }, timeout: 12000,
        });
        info.socket.destroy();
        const kind = host.startsWith('api.') ? 'API' : 'DC';
        if (kind === 'API') apiOk++; else dcOk++;
        console.log('OK', kind, 'p'+port, host, Date.now()-t0+'ms');
      } catch (e) {
        fail++;
        console.log('FAIL', 'p'+port, host, e.message.slice(0,70), Date.now()-t0+'ms');
      }
    }
  }
  console.log(JSON.stringify({ dcOk, apiOk, fail, verdict: dcOk > 0 ? 'LOGIN_DC_OK' : 'LOGIN_DC_STILL_DEAD' }));
})();
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
grep -a 'Login (residential)' /root/.pm2/logs/tgbot-out.log | tail -1 | cut -c1-160
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e["status"],"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()])})'
echo MOBILE25_OK
