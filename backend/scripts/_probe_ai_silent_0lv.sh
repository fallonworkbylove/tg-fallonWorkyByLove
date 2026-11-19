#!/bin/bash
echo "=== AI silent probe $(date -u +%H:%M)UTC ==="
curl -sS -m 8 http://127.0.0.1:3000/api/health; echo
node <<'NODE'
const {execSync}=require('child_process');
const d=JSON.parse(execSync('pm2 jlist',{encoding:'utf8'}));
const e=d.find(x=>x.name==='tgbot').pm2_env;
const k=String(e.OPENAI_API_KEY||'');
const pl=String(e.PROXY_LIST||'').split(';').filter(Boolean);
const fake=!k||k.length<20||k.startsWith('sk-deploy')||k.startsWith('sk-audit')||k.startsWith('sk-test');
console.log({
  status:e.status,
  PROXY:pl.length,
  openai_len:k.length,
  openai_fake:fake,
  uptime_m:Math.round((Date.now()-e.pm_uptime)/60000),
  restarts:e.restart_time,
});
NODE
echo "--- last replies ---"
grep -aE 'Ответ для' /root/.pm2/logs/tgbot-out.log | tail -15
echo "--- silence / circuit / failover ---"
grep -aE 'AI silence|circuit OPEN|proxy .*сдох|AI замолчал|silence-heal|Ошибка обработки|Incorrect API key|REFUSE|openai_ready|Занята' /root/.pm2/logs/tgbot-out.log | tail -40
echo "--- err tail ---"
grep -aE 'Connection error|Incorrect API key|circuit|Ошибка обработки|TypeError|REFUSE|Socks|ETIMEDOUT' /root/.pm2/logs/tgbot-error.log | tail -25
echo "--- out last 30 ---"
tail -30 /root/.pm2/logs/tgbot-out.log
