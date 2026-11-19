#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
TOK=$(python3 -c "import re;m=re.search(r'^ADMIN_CONSOLE_TOKEN=(.+)$',open('.env',encoding='utf-8',errors='ignore').read(),re.M);print(m.group(1).strip().strip(chr(34)).strip(chr(39)) if m else '')")
export ADMIN_CONSOLE_TOKEN="$TOK"
echo "=== pm2 env PROXY_LIST count ==="
pm2 env 9 2>/dev/null | grep -E '^PROXY_LIST' | head -c 200; echo
node -e "
const raw=process.env.PROXY_LIST||'';
const n=raw.split(/[;\\n\\r]+/).map(s=>s.trim()).filter(Boolean).length;
console.log('pm2-injected process would need restart; dotenv file count via script next');
"
echo "=== .env PROXY_LIST entries ==="
node scripts/_probe_proxy_counts.js 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s.match(/\{[\s\S]*\}$/)[0]); console.log('dotenv work', j.workPool, 'login', j.loginPool);});"
echo "=== live API /proxies ==="
node <<'NODE'
require('dotenv').config();
const http=require('http');
const tok=process.env.ADMIN_CONSOLE_TOKEN;
http.get({hostname:'127.0.0.1',port:Number(process.env.PORT||3000),path:'/api/admin/console/proxies',headers:{'X-Admin-Console-Token':tok}},res=>{
  let b=''; res.on('data',c=>b+=c); res.on('end',()=>{
    const j=JSON.parse(b);
    console.log('api work', j.proxies?.work?.length, 'login', j.proxies?.login?.length);
    console.log('api work labels', (j.proxies?.work||[]).map(x=>x.label));
  });
}).on('error',e=>{console.error(e); process.exit(1);});
NODE
