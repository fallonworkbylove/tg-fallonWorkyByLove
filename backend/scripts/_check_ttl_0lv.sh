#!/bin/bash
sed -n '175,200p' /root/opt/tgbot/tg-miniapp-loverussian/backend/services/aiResponder.js
echo "---"
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node <<'NODE'
const pp = require('./services/proxyPools');
const p = pp.PROXY_POOL.find((x) => x && x.ip === '196.18.14.240');
console.log({ found: Boolean(p), dead: p ? pp.isProxyDead(p) : null, defaultTtl: 12 * 60 * 1000 });
// simulate mark with default
if (p) {
  pp.markProxyDead(p, 'test-ttl-check', 12 * 60 * 1000);
}
NODE
grep -aE 'test-ttl-check|skip ~' /root/.pm2/logs/tgbot-error.log | tail -5
