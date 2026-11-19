#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
cd "$B/backend"
KEY=$(grep '^TELEGRAM_AUTH_BYPASS_KEY=' .env | cut -d= -f2-)

# Second catch-up wave
curl -sS --max-time 40 -X POST -H "X-Auth-Bypass-Key: $KEY" \
  http://127.0.0.1:3000/api/accounts/catch-up-all
echo
sleep 90

# Light online count via isActive only (no ping)
curl -sS --max-time 15 -H "X-Auth-Bypass-Key: $KEY" \
  "http://127.0.0.1:3000/api/accounts/pool-status" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const ai=j.accounts.filter(a=>a.ai&&a.has_session);const on=ai.filter(a=>a.is_online);console.log(JSON.stringify({online:j.online,pingOk:j.pingOk,ai_sess:ai.length,ai_online:on.length,offline_ai:ai.filter(a=>!a.is_online).map(a=>a.id)}))})"

echo
AUDIT_FIX_SINCE='2026-10-27 15:30:00' node scripts/_audit_10of10_score.js
echo
node -e "
require('dotenv').config({quiet:true});
const db=require('./db');
(async()=>{
  const [gap]=await db.execute(\`
    SELECT cm.account_id, cm.peer_id, LEFT(cm.content,70) c, cm.created_at
    FROM conversation_messages cm
    JOIN accounts a ON a.id=cm.account_id
    WHERE cm.role='user' AND cm.created_at > NOW() - INTERVAL 3 HOUR
      AND a.is_autoreply_enabled=1 AND IFNULL(a.prompt,'')!=''
      AND a.session_string IS NOT NULL AND a.session_string!=''
      AND NOT EXISTS (SELECT 1 FROM conversation_messages x WHERE x.account_id=cm.account_id AND x.peer_id=cm.peer_id AND x.role='assistant' AND x.id>cm.id)
      AND NOT EXISTS (SELECT 1 FROM autoreply_disabled_peers ad WHERE ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id)
    ORDER BY cm.id DESC LIMIT 20\`);
  console.log('remaining_gaps', gap.length);
  for (const r of gap) console.log(String(r.created_at), 'acc'+r.account_id, r.peer_id, r.c);

  const [newWeak]=await db.execute(\`
    SELECT account_id, content, created_at FROM conversation_messages
    WHERE role='assistant' AND created_at >= '2026-10-27 15:30:00'
      AND TRIM(content) IN ('а ещё)','а ещё','ага','ага)','круто)','круто','хм ок','хм ок)','ну да)','ладно')
    ORDER BY id DESC LIMIT 15\`);
  console.log('new_stubs_after_fix', newWeak.length);
  for (const r of newWeak) console.log(String(r.created_at), 'acc'+r.account_id, JSON.stringify(r.content));

  const [newLeak]=await db.execute(\`
    SELECT account_id, LEFT(content,100) c, created_at FROM conversation_messages
    WHERE role='assistant' AND created_at >= '2026-10-27 15:30:00'
      AND (content LIKE '%[отправила %' OR content LIKE '%{фото:%' OR content LIKE '%{кружок:%')
      AND content NOT LIKE '[медиа:%'
    LIMIT 10\`);
  console.log('new_leaks_after_fix', newLeak.length);

  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
"
echo VERIFY_DONE
