#!/bin/bash
set -euo pipefail
echo "=== pm2 ==="
pm2 jlist | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const p=JSON.parse(d).find(x=>x.name==="tgbot");const pl=p.pm2_env.PROXY_LIST||"";console.log({status:p.pm2_env.status,uptime_s:Math.round((Date.now()-p.pm2_env.pm_uptime)/1000),restarts:p.pm2_env.restart_time,proxy:pl.split(";").filter(Boolean).length});});'
echo "=== boot ==="
grep -aE 'opsQuality|Server is running|Work \(DC\) пул' /root/.pm2/logs/tgbot-out.log | tail -8
echo "=== recent inbound/outbound ==="
grep -aE ']: .*: "|outbound |Отправил|→ |ответил, сколько|AI не|молчу|generateReply|OpenAI' /root/.pm2/logs/tgbot-out.log | tail -50
echo "=== err tail ==="
tail -n 30 /root/.pm2/logs/tgbot-error.log
echo "=== silence/openai ==="
grep -aE 'AI замолчал|OpenAI|billing|rate limit|429|ECONN|proxy' /root/.pm2/logs/tgbot-out.log /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -20
echo WATCH_DONE
