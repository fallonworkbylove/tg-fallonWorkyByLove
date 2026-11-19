#!/usr/bin/env node
/* Probe PROXY_LIST socks5 → Telegram DC :443 */
require('dotenv').config();
const { SocksClient } = require('socks');

const DCS = [
  '149.154.175.54',
  '149.154.167.51',
  '149.154.167.41',
];

function parseSocks() {
  const raw = process.env.PROXY_LIST || '';
  const out = [];
  for (const entry of raw.split(';')) {
    const parts = entry.trim().split(':').map((s) => s.trim());
    const type = (parts[0] || '').toLowerCase();
    if (type !== 'socks5' && type !== 'socks') continue;
    const [, host, port, user, pass] = parts;
    if (!host || !port) continue;
    out.push({
      host,
      port: Number(port),
      userId: user || undefined,
      password: pass || undefined,
    });
  }
  return out;
}

(async () => {
  const list = parseSocks();
  console.log('proxies', list.length);
  const okHosts = [];
  for (const px of list) {
    const label = `${px.host}:${px.port}`;
    let anyOk = false;
    for (const dest of DCS) {
      try {
        const info = await SocksClient.createConnection({
          proxy: {
            host: px.host,
            port: px.port,
            type: 5,
            userId: px.userId,
            password: px.password,
          },
          command: 'connect',
          destination: { host: dest, port: 443 },
          timeout: 10000,
        });
        info.socket.destroy();
        console.log('OK', label, '->', dest);
        anyOk = true;
        break;
      } catch (e) {
        console.log('FAIL', label, '->', dest, String(e.message || e).split('\n')[0].slice(0, 60));
      }
    }
    if (anyOk) okHosts.push(label);
  }
  console.log('TG_OK_COUNT', okHosts.length, okHosts.join(','));
})();
