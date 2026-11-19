#!/bin/bash
# Live AI health probe
set -u
BASE=/root/opt/tgbot/tg-miniapp-loverussian
echo "=== $(date -u +%H:%M)UTC AI probe ==="
pm2 jlist | node -e '
let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
  const j=JSON.parse(d); const e=j.find(x=>x.name==="tgbot").pm2_env;
  const pl=String(e.PROXY_LIST||"").split(";").filter(Boolean);
  console.log("pm2",e.status,"pid",e.pm_pid,"uptime_ms",Date.now()-e.pm_uptime,"PROXY",pl.length,"restarts",e.restart_time);
});
'
curl -sS -m 8 http://127.0.0.1:3000/api/health || echo HEALTH_FAIL
echo
echo "--- openai / circuit / silence ---"
grep -aE 'openai|OPENAI|circuit|AI замолчал|REFUSE_PROXY|прокси|SOCKS|rate.?limit|429|insufficient|billing' /root/.pm2/logs/tgbot-out*.log /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -40
echo "--- recent errors ---"
tail -40 /root/.pm2/logs/tgbot-error.log 2>/dev/null
echo "--- recent out (ai/reply) ---"
grep -aE 'ответил|outbound |AI |flush|generateReply|skip|тишин|deferred|busy|circuit' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | tail -40
echo "--- sessions ---"
cd "$BASE/backend" && node -e '
require("dotenv").config();
const db=require("./db");
(async()=>{
  const [[s]]=await db.execute("SELECT COUNT(*) t, SUM(is_active=1) a, SUM(ai_enabled=1 OR autoreply_enabled=1) ai FROM accounts");
  console.log("accounts",s);
  try{
    const [rows]=await db.execute("SELECT id, phone, LEFT(prompt,20) p, is_active, updated_at FROM accounts ORDER BY updated_at DESC LIMIT 8");
    console.log(rows);
  }catch(e){ console.log("acc_err",e.message); }
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
' 2>&1 | tail -30
