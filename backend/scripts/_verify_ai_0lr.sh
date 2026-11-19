#!/bin/bash
set -euo pipefail
echo "=== verify AI after key restore ==="
node -e '
const {execSync}=require("child_process");
const d=JSON.parse(execSync("pm2 jlist",{encoding:"utf8"}));
const e=d.find(x=>x.name==="tgbot").pm2_env;
const k=String(e.OPENAI_API_KEY||"");
const pl=String(e.PROXY_LIST||"").split(";").filter(Boolean);
const fake=/^(sk-deploy|sk-audit|sk-test)/.test(k) || k.length<20;
console.log({prefix:k.slice(0,10),len:k.length,fake,PROXY:pl.length,status:e.status,uptime_s:Math.round((Date.now()-e.pm_uptime)/1000)});
if(fake||e.status!=="online"||pl.length<5) process.exit(1);
'
curl -sS -m 8 http://127.0.0.1:3000/api/health; echo
# errors only after this process started (approx last 2 min of log file size slice)
echo "--- last 20 errors ---"
tail -20 /root/.pm2/logs/tgbot-error.log
echo "--- last replies / silence ---"
grep -aE 'Ответ для|outbound |AI silence|Incorrect API key|sk-deploy' /root/.pm2/logs/tgbot-out.log /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -25
# Live openai models ping with pm2 key (no print)
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node - <<'NODE'
const { execSync } = require('child_process');
const OpenAI = require('openai');
const d = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' }));
const key = d.find((x) => x.name === 'tgbot').pm2_env.OPENAI_API_KEY;
const client = new OpenAI({ apiKey: key });
client.models
  .list()
  .then((r) => {
    const n = (r.data || []).length;
    console.log('openai_models_ok', n > 0, 'count', n);
    process.exit(n > 0 ? 0 : 2);
  })
  .catch((e) => {
    console.error('openai_ping_fail', e.message);
    process.exit(3);
  });
NODE
