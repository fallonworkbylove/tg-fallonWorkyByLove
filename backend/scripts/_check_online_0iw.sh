#!/bin/bash
sleep 20
echo '===LATEST==='
grep -aE 'Восстановление сессий завершено|активирован|AUTH_KEY_DUPLICATED — жду|подключён со 2|SESSION_WATCH|ok=' /root/.pm2/logs/tgbot-out.log /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -60
echo '===HEALTH==='
curl -s http://127.0.0.1:3000/api/health || true
echo
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node <<'NODE'
const fs=require('fs');
for (const line of fs.readFileSync('.env','utf8').split(/\n/)) {
  const m=line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]]=m[2].trim();
}
try {
  const { getActiveClientCount } = require('./services/clientPool');
  console.log('activeCount', getActiveClientCount());
} catch (e) {
  console.log('count_fail', e.message);
}
NODE
