#!/bin/bash
set -uo pipefail
echo "===== IPs ====="
dig +short loverussian.duckdns.org A
dig +short ops-loverussian.duckdns.org A
hostname -I | awk '{print $1}'
ip -4 addr show | awk '/inet /{print $2}' | head -5

echo "===== listen ====="
ss -lntp | grep -E ':80|:443|:3000' || netstat -lntp 2>/dev/null | grep -E ':80|:443|:3000'

echo "===== bypass probe local ====="
# without token to /api/accounts via loopback through nginx vs node
curl -s -o /tmp/b1 -w 'node_accounts=%{http_code}\n' http://127.0.0.1:3000/api/accounts
head -c 120 /tmp/b1; echo
curl -s -o /tmp/b2 -w 'nginx_accounts=%{http_code}\n' -H 'Host: loverussian.duckdns.org' http://127.0.0.1/api/accounts
head -c 120 /tmp/b2; echo
curl -s -o /tmp/b3 -w 'nginx_ops_api=%{http_code}\n' -H 'Host: loverussian.duckdns.org' http://127.0.0.1/api/admin/console
head -c 120 /tmp/b3; echo

echo "===== ops subdomain local host ====="
curl -s -o /tmp/b4 -w 'ops_host80=%{http_code}\n' -H 'Host: ops-loverussian.duckdns.org' http://127.0.0.1/
head -c 80 /tmp/b4; echo

echo "===== silence catchup module status ====="
grep -n 'healed\|findDbSilenceGaps\|INTERVAL' /root/opt/tgbot/tg-miniapp-loverussian/backend/services/silenceCatchup.js | head -20
node -e "
require('dotenv').config({path:'/root/opt/tgbot/tg-miniapp-loverussian/backend/.env'});
process.chdir('/root/opt/tgbot/tg-miniapp-loverussian/backend');
const { findDbSilenceGaps } = require('./services/silenceCatchup');
findDbSilenceGaps().then(g=>{console.log('gaps_found', Array.isArray(g)?g.length:g); console.log(JSON.stringify((g||[]).slice(0,8),null,2)); process.exit(0);}).catch(e=>{console.error('gap_err',e.message); process.exit(1);});
"
