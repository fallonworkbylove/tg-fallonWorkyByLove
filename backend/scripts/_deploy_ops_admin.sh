#!/bin/bash
set -euo pipefail
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
B="$ROOT/backend"
F="$ROOT/frontend"

cp -f /tmp/adminLogBuffer.js /tmp/adminOps.js "$B/services/"
cp -f /tmp/adminConsole.js "$B/routes/"
cp -f /tmp/server.js "$B/"
cp -f /tmp/updates.js /tmp/index.html "$F/"

cd "$B"
KEY=$(python3 -c "import re;m=re.search(r'^OPENAI_API_KEY=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export OPENAI_API_KEY="$KEY"
TOK=$(python3 -c "import re;m=re.search(r'^ADMIN_CONSOLE_TOKEN=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export ADMIN_CONSOLE_TOKEN="$TOK"

timeout 60 pm2 restart tgbot --update-env
pm2 save
sleep 6

node <<'NODE'
require('dotenv').config();
const http = require('http');
const tok = process.env.ADMIN_CONSOLE_TOKEN;

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request({
      hostname: '127.0.0.1',
      port: Number(process.env.PORT || 3000),
      path,
      method,
      headers: {
        'X-Admin-Console-Token': tok,
        Accept: 'application/json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
      },
      timeout: 60000,
    }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const snap = await req('GET', '/api/admin/console');
  if (snap.status !== 200) {
    console.error('console fail', snap.status, snap.body.slice(0, 300));
    process.exit(1);
  }
  const proxies = await req('GET', '/api/admin/console/proxies');
  if (proxies.status !== 200) {
    console.error('proxies fail', proxies.status, proxies.body.slice(0, 300));
    process.exit(1);
  }
  const logs = await req('GET', '/api/admin/console/logs?limit=5');
  if (logs.status !== 200) {
    console.error('logs fail', logs.status, logs.body.slice(0, 300));
    process.exit(1);
  }
  const bl = await req('GET', '/api/admin/console/blacklist');
  if (bl.status !== 200) {
    console.error('blacklist fail', bl.status, bl.body.slice(0, 300));
    process.exit(1);
  }
  const j = JSON.parse(snap.body);
  const p = JSON.parse(proxies.body);
  const l = JSON.parse(logs.body);
  console.log(JSON.stringify({
    day: j.console?.messages?.day?.sent,
    online: j.console?.accounts?.online,
    workProxies: p.proxies?.work?.length,
    loginProxies: p.proxies?.login?.length,
    logLines: l.lines?.length,
    bl: (JSON.parse(bl.body).blacklist || []).length,
  }));
  console.log('DEPLOY_OK');
})().catch((e) => { console.error(e); process.exit(1); });
NODE
