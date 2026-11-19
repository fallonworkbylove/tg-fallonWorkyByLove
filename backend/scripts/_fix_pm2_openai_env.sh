#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

KEY=$(python3 - <<'PY'
import re
env=open('.env','r',encoding='utf-8',errors='ignore').read()
m=re.search(r'^OPENAI_API_KEY=(.+)$', env, re.M)
print(m.group(1).strip().strip('"').strip("'") if m else '')
PY
)
if [ -z "$KEY" ] || [ "$KEY" = "sk-test" ] || [ "${#KEY}" -lt 20 ]; then
  echo "BAD_KEY_IN_ENV"
  exit 1
fi
echo "dotenv_key ${KEY:0:8}… len=${#KEY}"

echo "=== before ==="
node -e "
const {execSync}=require('child_process');
const apps=JSON.parse(execSync('pm2 jlist',{encoding:'utf8'}));
const a=apps.find(x=>x.name==='tgbot');
const k=(a&&a.pm2_env&&a.pm2_env.OPENAI_API_KEY)||'';
console.log('pm2_key', k?(k.slice(0,8)+'… len='+k.length+(k==='sk-test'?' <<POISONED>>':'')):'MISSING');
"

# dotenv не перекрывает уже заданный process.env — убираем sk-test из pm2.
export OPENAI_API_KEY="$KEY"
pm2 restart tgbot --update-env
pm2 save
sleep 4

echo "=== after ==="
node -e "
const {execSync}=require('child_process');
const apps=JSON.parse(execSync('pm2 jlist',{encoding:'utf8'}));
const a=apps.find(x=>x.name==='tgbot');
const k=(a&&a.pm2_env&&a.pm2_env.OPENAI_API_KEY)||'';
const bad=k==='sk-test'||!k;
console.log('pm2_key', k?(k.slice(0,8)+'… len='+k.length):'MISSING', bad?'BAD':'OK');
console.log('pid', a&&a.pid, 'status', a&&a.pm2_env&&a.pm2_env.status);
if (bad) process.exit(2);
"

echo "=== ping ==="
node scripts/_ping_openai.js

echo "=== err sample (should not be sk-test) ==="
sleep 5
pm2 logs tgbot --err --lines 20 --nostream 2>/dev/null | grep -E 'sk-test|401 Incorrect' | tail -5 || echo 'no_sk_test_401'
pm2 logs tgbot --out --lines 30 --nostream 2>/dev/null | grep -E 'Запрос к модели|Ответ для' | tail -10 || true
echo DEPLOY_OK
