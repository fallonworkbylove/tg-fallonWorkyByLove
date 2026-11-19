#!/bin/bash
set -e
echo "=== pm2 ==="
pm2 jlist | node -e '
let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
  const j=JSON.parse(d); const e=j.find(x=>x.name==="tgbot").pm2_env;
  const pl=String(e.PROXY_LIST||"").split(";").filter(Boolean);
  console.log("status",e.status,"PROXY",pl.length,"restarts",e.restart_time);
});
'
echo "=== audit progress ==="
ps aux | grep -E '0lq|hard_audit|ultra' | grep -v grep || echo none
echo "=== audit out ==="
tail -60 /tmp/0lq/audit_c_out.txt 2>/dev/null || echo no_out
echo "=== hard ==="
tail -20 /tmp/hard_0ht.txt 2>/dev/null || echo no_hard
echo "=== live greps ==="
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|Дайджест отсева|outbound |Login DC' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | tail -12 || true
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY|TypeError|circuit OPEN' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -12 || true
