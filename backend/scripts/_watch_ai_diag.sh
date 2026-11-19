#!/bin/bash
set -euo pipefail
date -u
pm2 jlist | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const p=JSON.parse(d).find(x=>x.name==="tgbot");console.log({status:p.pm2_env.status,pid:p.pid,up_min:+((Date.now()-p.pm2_env.pm_uptime)/60000).toFixed(1),restarts:p.pm2_env.restart_time,unstable:p.pm2_env.unstable_restarts});});'
echo ===LOGS===
ls -la /root/.pm2/logs/tgbot-out.log /root/.pm2/logs/tgbot-error.log
echo ===ERR_TAIL===
tail -n 40 /root/.pm2/logs/tgbot-error.log
echo ===OUT_TAIL===
tail -n 40 /root/.pm2/logs/tgbot-out.log
echo ===CLIENTS===
grep -aE 'сессия|онлайн|connected|NewMessage|GramJS|client ready|аккаунт.*запущ|bootstrap|Flood' /root/.pm2/logs/tgbot-out.log | tail -25
echo DIAG_OK
