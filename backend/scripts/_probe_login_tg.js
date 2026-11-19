#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const { SocksClient } = require('socks');

const dest = '149.154.167.51';
const raw = fs.readFileSync('config/proxies-login.txt', 'utf8');
const lines = raw
  .split(/\n/)
  .map((s) => s.trim())
  .filter((s) => /socks5/i.test(s))
  .slice(0, 12);

(async () => {
  let ok = 0;
  for (const entry of lines) {
    const parts = entry.replace(/^socks5:/i, '').split(':');
    const [host, port, user, pass] = parts;
    const label = `${host}:${port}`;
    try {
      const info = await SocksClient.createConnection({
        proxy: {
          host,
          port: Number(port),
          type: 5,
          userId: user,
          password: pass,
        },
        command: 'connect',
        destination: { host: dest, port: 443 },
        timeout: 8000,
      });
      info.socket.destroy();
      console.log('OK', label);
      ok += 1;
    } catch (e) {
      console.log('FAIL', label, String(e.message || e).slice(0, 50));
    }
  }
  console.log('LOGIN_TG_OK', ok);
})();
