#!/bin/bash
echo "=== audit C 0lu $(date -u +%H:%M)UTC ==="
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
echo "--- wiring ---"
grep -n "Connection error" /root/opt/tgbot/tg-miniapp-loverussian/backend/services/proxyPools.js | head -5
grep -n "openaiCreateWithProxyFailover" /root/opt/tgbot/tg-miniapp-loverussian/backend/services/ragExamples.js | head -3
grep -n "CALL_ONLY_RE\|healFailCooldown" /root/opt/tgbot/tg-miniapp-loverussian/backend/services/silenceCatchup.js | head -8
echo "--- live replies ---"
grep -aE 'Ответ для|proxy .*сдох' /root/.pm2/logs/tgbot-out.log | tail -20
echo "--- recent errors ---"
grep -aE 'Connection error|Incorrect API key|REFUSE_PROXY|circuit OPEN' /root/.pm2/logs/tgbot-error.log | tail -15
echo "--- beri loop ---"
grep -aE 'Бери трубку' /root/.pm2/logs/tgbot-out.log | tail -5
echo "--- hard audit if present ---"
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
if [ -f scripts/_hard_audit_full_0ht.js ]; then
  (export AUDIT_SMOKE=1 OPENAI_API_KEY=sk-audit-c; node scripts/_hard_audit_full_0ht.js) || echo HARD_AUDIT_SOFT_FAIL
elif [ -f scripts/_hard_audit_0ht.js ]; then
  (export AUDIT_SMOKE=1 OPENAI_API_KEY=sk-audit-c; node scripts/_hard_audit_0ht.js) || echo HARD_AUDIT_SOFT_FAIL
else
  echo NO_HARD_AUDIT_SCRIPT
fi
echo AUDIT_C_0LU_DONE
