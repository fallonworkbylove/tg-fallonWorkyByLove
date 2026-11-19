#!/bin/bash
set -e
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

echo "=== .env PROXY_LIST head ==="
grep '^PROXY_LIST=' .env | head -c 160
echo
echo

echo "=== process PROXY_LIST ==="
PID=$(pm2 pid tgbot)
echo "PID=$PID"
if [ -n "$PID" ] && [ -d "/proc/$PID" ]; then
  tr '\0' '\n' < /proc/$PID/environ | grep '^PROXY_LIST=' | head -c 160 || echo '(no PROXY_LIST in process env)'
  echo
else
  echo 'process missing'
fi
echo

echo "=== dotenv via node ==="
node -e "
require('dotenv').config();
const pl=process.env.PROXY_LIST||'';
console.log('starts', pl.slice(0,100));
console.log('count', pl.split(';').filter(Boolean).length);
console.log('has72', pl.includes('72.56.182'));
console.log('idx209', pl.indexOf('209.127'));
console.log('idx72', pl.indexOf('72.56.182'));
"

echo
echo "=== recent proxy/openai logs ==="
pm2 logs tgbot --lines 40 --nostream 2>/dev/null | grep -iE 'proxy|openai|SOCKS|Connected|activated|не в сети|isActive|online' | tail -n 25

echo
echo "=== account active status via node ==="
node -e "
require('dotenv').config();
const tc=require('./services/telegramClient');
// give module a moment - just list isActive if clients already up
setTimeout(()=>{
  try {
    const db=require('./db');
    // soft check exported helpers
    console.log('isActive type', typeof tc.isActive);
  } catch(e){ console.log(e.message); }
  process.exit(0);
}, 500);
" 2>&1 | tail -n 20
