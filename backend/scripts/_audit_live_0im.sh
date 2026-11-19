#!/bin/bash
set -e
ROOT=/root/opt/tgbot/tg-miniapp-loverussian
cd "$ROOT"

echo "=== LIVE OUT ==="
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|outbound ' /root/.pm2/logs/tgbot-out.log | tail -30 || true
echo "=== LIVE ERR ==="
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY' /root/.pm2/logs/tgbot-error.log | tail -20 || true
echo "=== PM2/PROXY ==="
pm2 jlist | node -e '
let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>{
  const j=JSON.parse(d); const t=j.find(x=>x.name==="tgbot");
  const st=t&&t.pm2_env&&t.pm2_env.status;
  const env=t&&t.pm2_env&&t.pm2_env.env||{};
  const pl=(env.PROXY_LIST||process.env.PROXY_LIST||"").split(",").filter(Boolean).length;
  console.log("status", st, "PROXY", pl);
});
'
echo "=== HARD AUDIT ==="
node backend/scripts/_hard_audit_0ht.js
echo "=== SMOKE 0im ==="
node backend/scripts/_smoke_agree_pack_0im.js
echo "DONE_AUDIT_0im"
