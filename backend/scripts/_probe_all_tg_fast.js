#!/usr/bin/env node
require('dotenv').config();
const { SocksClient } = require('socks');

const raw = process.env.PROXY_LIST || '';
const list = [];
for (const e of raw.split(';')) {
  const p = e.trim().split(':');
  if ((p[0] || '').toLowerCase() !== 'socks5') continue;
  list.push({ host: p[1], port: +p[2], userId: p[3], password: p[4] });
}

(async () => {
  let ok = 0;
  for (const px of list) {
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
        destination: { host: '149.154.167.51', port: 443 },
        timeout: 7000,
      });
      info.socket.destroy();
      console.log('OK', `${px.host}:${px.port}`);
      ok += 1;
    } catch (_) {
      console.log('FAIL', px.host);
    }
  }
  console.log('TG_OK_TOTAL', ok, '/', list.length);
})();
