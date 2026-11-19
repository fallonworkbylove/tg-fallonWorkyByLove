#!/bin/bash
set -e
ERR=/root/.pm2/logs/tgbot-error.log
OUT=/root/.pm2/logs/tgbot-out.log

echo "=== ERR pattern counts (last 8k lines) ==="
tail -n 8000 "$ERR" | grep -oE 'INVITE_HASH_EXPIRED|Invalid body|PHONE_CODE_INVALID|fetch failed|FLOOD_WAIT|AUTH_KEY|SESSION|429|timeout|ECONNRESET|USER_DEACTIVATED|PEER_FLOOD' | sort | uniq -c | sort -rn

echo
echo "=== INVITE by account label ==="
tail -n 8000 "$ERR" | grep 'INVITE_HASH_EXPIRED' | sed -E 's/\].*$/]/' | sort | uniq -c | sort -rn | head

echo
echo "=== Invalid body by account ==="
tail -n 8000 "$ERR" | grep 'Invalid body' | sed -E 's/.*аккаунт ([0-9]+).*/acc \1/' | sort | uniq -c | sort -rn | head

echo
echo "=== Recent out: media fail / flood / busy ==="
tail -n 4000 "$OUT" | grep -E 'Ошибка отправки медиа|Flood|занята|INVITE|mediaMiss|Просит фото|Автоответ отключ' | tail -40

echo
echo "=== DB media links ==="
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node -e '
const db=require("./db");
(async()=>{
  const [rows]=await db.execute(
    "SELECT id, phone, LEFT(IFNULL(media_chat_link,\"\"),70) AS link FROM accounts WHERE IFNULL(media_chat_link,\"\")!=\"\" ORDER BY id"
  );
  for (const r of rows) console.log(r.id, r.phone, r.link);
  const [[a2]]=await db.execute("SELECT id, phone, is_autoreply_enabled, LEFT(IFNULL(prompt,\"\"),40) p FROM accounts WHERE id=2");
  console.log("account2:", a2);
  process.exit(0);
})().catch(e=>{console.error(e); process.exit(1);});
'
