#!/bin/bash
echo "=== AI alive $(date -u +%H:%M)UTC ==="
curl -sS -m 8 http://127.0.0.1:3000/api/health; echo
node -e '
const {execSync}=require("child_process");
const d=JSON.parse(execSync("pm2 jlist",{encoding:"utf8"}));
const e=d.find(x=>x.name==="tgbot").pm2_env;
const k=String(e.OPENAI_API_KEY||"");
const pl=String(e.PROXY_LIST||"").split(";").filter(Boolean);
const fake=!k||k.length<20||k.startsWith("sk-deploy")||k.startsWith("sk-audit")||k.startsWith("sk-test");
console.log({status:e.status, PROXY:pl.length, openai_len:k.length, openai_fake:fake, uptime_m:Math.round((Date.now()-e.pm_uptime)/60000)});
'
echo "--- last replies ---"
grep -aE 'Ответ для' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -12
echo "--- last errors ---"
grep -aE 'Incorrect API key|sk-deploy|Ошибка обработки|REFUSE_PROXY|circuit OPEN|TypeError' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -8
echo "--- silence ---"
grep -aE 'AI silence|AI замолчал' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -5
