#!/bin/bash
set -euo pipefail
PEER=suport_service_v
OUT=/root/.pm2/logs

echo "=== OCT29 first 15 lines ==="
grep -aF "$PEER" "$OUT/tgbot-out__2026-10-29_00-00-00.log" | head -15

echo "=== OCT29 first FLIP/NFT lines with context ==="
grep -anF "$PEER" "$OUT/tgbot-out__2026-10-29_00-00-00.log" | grep -aEi 'флип|nft|токен|нфт' | head -20

echo "=== OCT29 surrounding first flip (line nums) ==="
# get first matching line number
ln=$(grep -anE "Ответ для ${PEER}:.*флип|Ответ для ${PEER}:.*токен|Ответ для ${PEER}:.*NFT|Ответ для ${PEER}:.*нфт" "$OUT/tgbot-out__2026-10-29_00-00-00.log" | head -1 | cut -d: -f1 || true)
echo "FIRST_FLIP_LINE=$ln"
if [ -n "${ln:-}" ]; then
  start=$((ln>30 ? ln-30 : 1))
  sed -n "${start},$((ln+15))p" "$OUT/tgbot-out__2026-10-29_00-00-00.log"
fi

echo "=== timestamps near first flip (ISO if any) ==="
# pm2 often has no timestamps in line; check if log has them
head -3 "$OUT/tgbot-out__2026-10-29_00-00-00.log"
# use grep -a with flip and show nearby incoming ask about work
grep -aE "suport_service_v.*(работ|чем заним|хобби|флип)|Ответ для suport_service_v:.*флип" "$OUT/tgbot-out__2026-10-29_00-00-00.log" | head -40

echo "=== conversation_messages DB ==="
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node - <<'NODE'
const fs=require('fs');const path=require('path');
for (const line of fs.readFileSync('.env','utf8').split(/\r?\n/)) {
  const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(!m) continue;
  let v=m[2].trim();
  if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
  if(!process.env[m[1]]) process.env[m[1]]=v;
}
const db=require('./db');
(async()=>{
  // find peer_id variants
  const [rows]=await db.query(
    `SELECT account_id, peer_id, peer_username, role, LEFT(content,120) c, created_at
     FROM conversation_messages
     WHERE peer_username = 'suport_service_v' OR content LIKE '%Про флипинг ты же в первый день%'
     ORDER BY created_at ASC LIMIT 5`);
  console.log('by_username_first', rows);

  const [cnt]=await db.query(
    `SELECT COUNT(*) n, MIN(created_at) first_at, MAX(created_at) last_at
     FROM conversation_messages WHERE peer_username='suport_service_v'`);
  console.log('span', cnt[0]);

  const [flip]=await db.query(
    `SELECT account_id, peer_id, role, LEFT(content,160) c, created_at
     FROM conversation_messages
     WHERE peer_username='suport_service_v'
       AND (content LIKE '%флип%' OR content LIKE '%токен%' OR content LIKE '%NFT%' OR content LIKE '%нфт%')
     ORDER BY created_at ASC LIMIT 15`);
  console.log('flip_msgs', flip);

  const [day0]=await db.query(
    `SELECT DATE(created_at) d, COUNT(*) n
     FROM conversation_messages WHERE peer_username='suport_service_v'
     GROUP BY DATE(created_at) ORDER BY d`);
  console.log('by_day', day0);

  // peer_id numeric?
  if (flip[0]) {
    const pid=flip[0].peer_id;
    const [gates]=await db.query(`SELECT * FROM peer_nft_gates WHERE peer_id=? OR peer_id=?`,[String(pid),'suport_service_v']);
    console.log('gates', gates);
  }
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
NODE
