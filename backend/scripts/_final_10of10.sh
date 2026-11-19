#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
cp /tmp/replyPipeline.js "$B/backend/services/"
grep -n 'mediaHelpers.isContradictory' "$B/backend/services/replyPipeline.js"

timeout 40 pm2 restart tgbot --update-env || { pm2 stop tgbot; sleep 2; pm2 start tgbot; }
sleep 45
pm2 status tgbot | head -5

KEY=$(grep '^TELEGRAM_AUTH_BYPASS_KEY=' "$B/backend/.env" | cut -d= -f2-)
curl -sS --max-time 35 -X POST -H "X-Auth-Bypass-Key: $KEY" \
  http://127.0.0.1:3000/api/accounts/catch-up-all
echo
sleep 80

cd "$B/backend"
AUDIT_FIX_SINCE='2026-10-27 15:40:00' node scripts/_audit_10of10_score.js

node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [gap] = await db.execute(`SELECT cm.account_id, LEFT(cm.content,55) c,
    TIMESTAMPDIFF(MINUTE, cm.created_at, NOW()) age_m
    FROM conversation_messages cm JOIN accounts a ON a.id=cm.account_id
    WHERE cm.role='user' AND cm.created_at > NOW()-INTERVAL 3 HOUR
      AND a.is_autoreply_enabled=1 AND IFNULL(a.prompt,'')!=''
      AND a.session_string IS NOT NULL AND a.session_string!=''
      AND NOT EXISTS (SELECT 1 FROM conversation_messages x WHERE x.account_id=cm.account_id AND x.peer_id=cm.peer_id AND x.role='assistant' AND x.id>cm.id)
      AND NOT EXISTS (SELECT 1 FROM autoreply_disabled_peers ad WHERE ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id)
    ORDER BY cm.id DESC LIMIT 20`);
  console.log('gaps', gap.length);
  for (const r of gap) console.log(r.age_m + 'm', 'acc' + r.account_id, r.c);
  const [stubs] = await db.execute(`SELECT COUNT(*) c FROM conversation_messages WHERE role='assistant' AND created_at>='2026-10-27 15:40:00' AND TRIM(content) IN ('а ещё)','ага','ага)','круто)','хм ок')`);
  const [leaks] = await db.execute(`SELECT COUNT(*) c FROM conversation_messages WHERE role='assistant' AND created_at>='2026-10-27 15:40:00' AND content LIKE '%[отправила %' AND content NOT LIKE '[медиа:%'`);
  console.log('new_stubs', stubs[0].c, 'new_leaks', leaks[0].c);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE

# Only errors after this restart (last 8 min of log roughly via tail)
pm2 logs tgbot --err --lines 40 --nostream 2>/dev/null | grep -v telegramAuth | grep -iE 'isContradictory|not defined|Ошибка обработки' | tail -8 || echo 'clean_err'
echo FINAL_DONE
