#!/bin/bash
OUT=/root/.pm2/logs/tgbot-out.log
ERR=/root/.pm2/logs/tgbot-error.log
echo "=== $(date -Is) ==="
echo "=== last login lines ==="
grep -a '\[login\]' "$OUT" | tail -30
echo
echo "=== workerConnect out/err ==="
grep -a 'workerConnect\|код запрошен\|confirmCode\|SignIn\|revive\|code step' "$OUT" "$ERR" | tail -40
echo
echo "=== apiCall retries ==="
grep -a 'apiCall\|ответ боту' "$OUT" "$ERR" | tail -20
echo
echo "=== account in db? ==="
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node -e "
const db=require('./db');
(async()=>{
  const [r]=await db.execute(\"SELECT id,phone,status,CHAR_LENGTH(IFNULL(session_string,'')) slen FROM accounts WHERE phone LIKE '%9324436535%' LIMIT 3\");
  console.log(r);
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
" 2>/dev/null || echo "(db probe skipped)"
