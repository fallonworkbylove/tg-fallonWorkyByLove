#!/usr/bin/env node
/* Probe PROXY_LIST socks5 → api.openai.com:443 */
require('dotenv').config();
const { SocksClient } = require('socks');

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
  for (const px of list) {
    const label = `${px.host}:${px.port}`;
    try {
      const info = await SocksClient.createConnection({
        proxy: { host: px.host, port: px.port, type: 5, userId: px.userId, password: px.password },
        command: 'connect',
        destination: { host: 'api.openai.com', port: 443 },
        timeout: 8000,
      });
      info.socket.destroy();
      console.log('OK', label);
    } catch (e) {
      console.log('FAIL', label, String(e.message || e).split('\n')[0].slice(0, 100));
    }
  }
})();
