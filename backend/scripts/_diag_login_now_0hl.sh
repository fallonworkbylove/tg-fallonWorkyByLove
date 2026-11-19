#!/bin/bash
set -uo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo "======== DIAG LOGIN $(date -u +%H:%MZ) ========"

echo "===== PM2 ====="
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e["status"],"pid":p.get("pid"),"uptime_ms":(__import__("time").time()*1000-p.get("pm_uptime",0)),"restarts":e.get("restart_time"),"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()]),"unstable":e.get("unstable_restarts")})'

echo "===== HTTP ====="
for u in /api/health / /ops/ /api/accounts; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:3000$u" || echo ERR)
  echo "$code $u"
done
curl -s -o /dev/null -w 'https_root=%{http_code}\n' --max-time 12 https://loverussian.duckdns.org/ || true

echo "===== login/QR/SMS out ====="
grep -aEi 'QR|qrcode|login|SMS|код|connect|GramJS|session|sendCode|SignIn|PHONE|FLOOD|AUTH_|proxy.*login|Login \(residential\)|не удалось|timeout|FROZEN' /root/.pm2/logs/tgbot-out.log | tail -50

echo "===== login/QR/SMS err ====="
grep -aEi 'QR|qrcode|login|SMS|sendCode|SignIn|PHONE|FLOOD|AUTH_|SocksClient|timeout|TypeError|Unhandled|connect' /root/.pm2/logs/tgbot-error.log | tail -40

echo "===== recent out (80) ====="
tail -n 80 /root/.pm2/logs/tgbot-out.log

echo "===== recent err (40) ====="
tail -n 40 /root/.pm2/logs/tgbot-error.log

echo "===== accounts ai ====="
node - <<'NODE'
require('dotenv').config();
const db=require('./db');
(async()=>{
  const [rows]=await db.query(`SELECT id, phone, is_autoreply_enabled,
    CHAR_LENGTH(COALESCE(session_string,'')) AS sess_len,
    updated_at FROM accounts ORDER BY id`);
  console.log(JSON.stringify(rows,null,2));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
NODE

echo "===== Warm ====="
grep -a 'Warm TG:' /root/.pm2/logs/tgbot-out.log | tail -5
grep -a 'Login (residential)' /root/.pm2/logs/tgbot-out.log | tail -3

echo DIAG_DONE
