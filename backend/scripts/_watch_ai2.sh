#!/bin/bash
set -euo pipefail
date -u
echo ===PM2===
pm2 jlist | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const p=JSON.parse(d).find(x=>x.name==="tgbot");console.log({status:p.pm2_env.status,up_min:+((Date.now()-p.pm2_env.pm_uptime)/60000).toFixed(1),restarts:p.pm2_env.restart_time,proxy:(p.pm2_env.PROXY_LIST||"").split(";").filter(Boolean).length});});'
echo ===OPS===
grep -aF 'opsQuality' /root/.pm2/logs/tgbot-out.log | tail -5
echo ===LAST_OTVET===
grep -aF 'Ответ для' /root/.pm2/logs/tgbot-out.log | tail -12
echo ===ERR_KEY===
grep -aE 'OpenAI|billing|429|ECONN|AI не дал|молчу' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -12 || true
grep -aE 'OpenAI|billing|429|AI не дал|молчу' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -12 || true
echo ===LOG_MTIME===
ls -la /root/.pm2/logs/tgbot-out.log /root/.pm2/logs/tgbot-error.log
echo WATCH2_OK
