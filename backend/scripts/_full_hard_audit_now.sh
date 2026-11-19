#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo "=== LIVE $(TZ=Europe/Moscow date) ==="
uptime
pm2 jlist | python3 -c 'import json,sys;j=json.load(sys.stdin);p=[x for x in j if x["name"]=="tgbot"][0];e=p["pm2_env"];print({"status":e.get("status"),"restarts":e.get("restart_time"),"PROXY":len([x for x in (e.get("PROXY_LIST")or"").split(";")if x.strip()]),"BYPASS":e.get("TELEGRAM_AUTH_BYPASS")})'
echo "=== HTTP ==="
curl -sS -o /dev/null -w "miniapp:%{http_code} ops:%{http_code}\n" --connect-timeout 8 https://loverussian.duckdns.org/ >/dev/null
curl -sS -o /dev/null -w "miniapp:%{http_code}\n" --connect-timeout 8 https://loverussian.duckdns.org/
curl -sS -o /dev/null -w "ops:%{http_code}\n" --connect-timeout 8 https://loverussian.duckdns.org/ops/
curl -sS -o /dev/null -w "api_noauth:%{http_code}\n" --connect-timeout 8 https://loverussian.duckdns.org/api/accounts || true
echo "=== NET ==="
curl -sS -o /dev/null -w "google:%{http_code}\n" --connect-timeout 5 https://www.google.com/ || echo google_FAIL
curl -sS -o /dev/null -w "tg_api:%{http_code}\n" --connect-timeout 8 https://api.telegram.org/ || echo TG_API_FAIL
echo "=== GREP OUT ==="
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|Дайджест отсева|outbound |Ответ для|Warm TG|SESSION_WATCH' /root/.pm2/logs/tgbot-out.log /root/.pm2/logs/tgbot-out__2026-11-03_00-00-00.log 2>/dev/null | tail -40
echo "=== GREP ERR ==="
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY|long polling|SESSION_WATCH|SocksClientError' /root/.pm2/logs/tgbot-error.log | tail -25
echo "=== DB ACCOUNTS ==="
python3 - <<'PY'
import re, subprocess
from pathlib import Path
env=Path('.env').read_text(encoding='utf-8',errors='ignore')
g=lambda k,d='': (m.group(1).strip() if (m:=re.search(rf'^{re.escape(k)}=(.*)$',env,re.M)) else d)
host,user,pw,db,port=g('DB_HOST','127.0.0.1'),g('DB_USER'),g('DB_PASSWORD'),g('DB_NAME'),g('DB_PORT','3306')
sql='''SELECT COUNT(*) accounts FROM accounts;
SELECT SUM(is_autoreply_enabled=1) ar_on, SUM(session_string IS NOT NULL AND session_string!="") sess FROM accounts;
SELECT id, phone, status, is_autoreply_enabled ar FROM accounts ORDER BY id;
SELECT COUNT(*) archived FROM archived_peers;
SELECT COUNT(*) disabled_peers FROM autoreply_disabled_peers;
'''
r=subprocess.run(['mysql','-h',host,'-P',port,'-u',user,f'-p{pw}',db,'-t','-e',sql],capture_output=True,text=True)
print(r.stdout)
if r.returncode: print(r.stderr[:500])
PY
echo "=== NIGHTLY IF PRESENT ==="
if [ -f scripts/_nightly_hard_audit.js ]; then
  OPENAI_API_KEY=sk-test node scripts/_nightly_hard_audit.js 2>&1 | tail -40
else
  echo no_nightly_script
  ls scripts/_hard_audit*.js 2>/dev/null | tail -5
fi
echo "=== PROXY TG QUICK (first 8) ==="
node -e '
require("dotenv").config();
const {SocksClient}=require("socks");
const raw=process.env.PROXY_LIST||"";
const list=[];
for (const e of raw.split(";")) {
  const p=e.trim().split(":");
  if ((p[0]||"").toLowerCase()!=="socks5") continue;
  list.push({host:p[1],port:+p[2],userId:p[3],password:p[4]});
}
const dests=[{host:"149.154.167.51",port:443},{host:"149.154.175.54",port:443}];
(async()=>{
  let ok=0;
  for (const px of list.slice(0,14)) {
    let tg=false;
    for (const d of dests) {
      try {
        const info=await SocksClient.createConnection({proxy:{host:px.host,port:px.port,type:5,userId:px.userId,password:px.password},command:"connect",destination:d,timeout:7000});
        info.socket.destroy(); tg=true; break;
      } catch(_){}
    }
    if (tg) ok++;
    console.log(tg?"TG_OK":"TG_FAIL", px.host+":"+px.port);
  }
  console.log("TG_OK_OF", ok, "/", Math.min(14,list.length), "total_pool", list.length);
})().catch(e=>console.error(e));
'
