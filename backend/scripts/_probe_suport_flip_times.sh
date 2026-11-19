#!/bin/bash
set -euo pipefail
PEER=suport_service_v
L29=/root/.pm2/logs/tgbot-out__2026-10-29_00-00-00.log
L30=/root/.pm2/logs/tgbot-out__2026-10-30_00-00-00.log
L31=/root/.pm2/logs/tgbot-out.log
L31r=/root/.pm2/logs/tgbot-out__2026-10-31_00-00-00.log

echo "=== 29: work ask + first flip (full) ==="
grep -aF "$PEER" "$L29" | grep -aE 'чем занима|флип|токен|Специфич|фейк|Анапу|сфера' | head -30

echo "=== 30: photo / nft / flip ==="
grep -aF "$PEER" "$L30" | grep -aEi 'флип|nft|токен|фото|скрин|профит|Daily flip|voice|кампан|tickNft|outbound' | head -40

echo "=== 31: hobby repeat ==="
grep -aF "$PEER" "$L31r" "$L31" 2>/dev/null | grep -aEi 'флип|хобби|кофе|повторя' | head -30

# try to recover wall-clock via journal if available
echo "=== journalctl near flip strings (MSK) ==="
journalctl -u pm2-root --since "2026-10-29" --until "2026-10-30" 2>/dev/null | grep -aF "$PEER" | grep -aE 'флип|чем занима' | head -10 || echo no_journal
# file mtime heuristic: line offset in rotated log
python3 - <<'PY'
from pathlib import Path
p=Path('/root/.pm2/logs/tgbot-out__2026-10-29_00-00-00.log')
data=p.read_bytes()
# find first flip reply
needle=b'Ответ для suport_service_v: "\xd1\x8f \xd0\xb7\xd0\xb0\xd0\xbd\xd0\xb8\xd0\xbc\xd0\xb0\xd1\x8e\xd1\x81\xd1\x8c \xd1\x84\xd0\xbb\xd0\xb8\xd0\xbf\xd0\xb8\xd0\xbd\xd0\xb3\xd0\xbe\xd0\xbc'
idx=data.find(needle)
print('flip_byte_offset', idx, 'file_size', len(data), 'frac', round(idx/len(data),4) if idx>=0 else None)
# also photo day30
p30=Path('/root/.pm2/logs/tgbot-out__2026-10-30_00-00-00.log')
d30=p30.read_bytes()
for label, n in [
 ('photo_profit', 'скриншот прибыли'.encode()),
 ('daily_flip', b'Daily flip'),
 ('flip_word', 'флип'.encode('utf-8')),
]:
    i=d30.find(n)
    # find with peer nearby
    print(label, 'first', i)
# find peer+flip sequences in day30
text=d30.decode('utf-8','replace')
lines=[ln for ln in text.splitlines() if 'suport_service_v' in ln and ('флип' in ln.lower() or 'NFT' in ln or 'нфт' in ln.lower() or 'токен' in ln.lower() or 'профит' in ln.lower())]
print('day30_nft_lines', len(lines))
for ln in lines[:20]:
    print(ln[:220])
PY

cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node - <<'NODE'
const fs=require('fs');
for (const line of fs.readFileSync('.env','utf8').split(/\r?\n/)) {
  const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(!m) continue;
  let v=m[2].trim();
  if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
  if(!process.env[m[1]]) process.env[m[1]]=v;
}
const db=require('./db');
(async()=>{
  const [allFlip]=await db.query(
    `SELECT role, content, created_at,
      TIMESTAMPDIFF(HOUR,
        (SELECT MIN(created_at) FROM conversation_messages WHERE peer_username='suport_service_v'),
        created_at) AS hours_from_start
     FROM conversation_messages
     WHERE peer_username='suport_service_v'
       AND (content LIKE '%флип%' OR content LIKE '%токен%' OR content LIKE '%NFT%' OR content LIKE '%нфт%' OR content LIKE '%профит%')
     ORDER BY created_at ASC`);
  console.log(JSON.stringify(allFlip,null,2));

  // search content that wasn't tagged peer_username - by peer_id
  const [byPid]=await db.query(
    `SELECT role, LEFT(content,140) c, created_at FROM conversation_messages
     WHERE peer_id='777481304' AND content LIKE '%флипингом токенов%'
     ORDER BY created_at ASC LIMIT 10`);
  console.log('by_pid_text_pitch', byPid);
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
NODE
