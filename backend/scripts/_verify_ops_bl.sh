#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian/backend
cp -f /tmp/adminOps.js "$B/services/"
cp -f /tmp/adminConsole.js "$B/routes/"
cd "$B"
timeout 50 pm2 restart tgbot --update-env
sleep 5
node <<'NODE'
require('dotenv').config();
const http = require('http');
const tok = process.env.ADMIN_CONSOLE_TOKEN;
http.get({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  path: '/api/admin/console/blacklist',
  headers: { 'X-Admin-Console-Token': tok, Accept: 'application/json' },
  timeout: 30000,
}, (res) => {
  let b = '';
  res.on('data', (c) => (b += c));
  res.on('end', () => {
    console.log(b);
    if (res.statusCode !== 200) process.exit(1);
    const j = JSON.parse(b);
    const names = (j.blacklist || []).map((x) => x.username || x.title).join(',');
    console.log('NAMES', names);
    if (!/sicretsolo/i.test(names) || !/wiolova/i.test(names)) {
      console.error('missing expected workers');
      process.exit(1);
    }
    console.log('BL_OK');
  });
}).on('error', (e) => { console.error(e); process.exit(1); });
NODE
