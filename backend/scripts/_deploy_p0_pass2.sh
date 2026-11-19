#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian

cp /tmp/replyPipeline.js /tmp/aiResponder.js /tmp/softHumanLite.js "$B/backend/services/"
cp /tmp/_audit_10of10_score.js /tmp/_smoke_10of10_fixes.js "$B/backend/scripts/"

# syntax-only (no OpenAI boot)
node --check "$B/backend/services/replyPipeline.js"
node --check "$B/backend/services/aiResponder.js"
node --check "$B/backend/services/softHumanLite.js"
grep -n 'isContradictoryMediaText,' "$B/backend/services/replyPipeline.js" | head -2
grep -n 'OPENAI_PROXY_INDEX\|socks5ListFromEnv' "$B/backend/services/aiResponder.js" | head -3

cd "$B/backend"
timeout 40 pm2 restart tgbot --update-env || { pm2 stop tgbot; sleep 2; pm2 start tgbot; }
sleep 35
pm2 status tgbot | head -5

pm2 logs tgbot --out --lines 60 --nostream 2>/dev/null | grep -E '\[openai\]|Work \(DC\)|online' | tail -8 || true

KEY=$(grep '^TELEGRAM_AUTH_BYPASS_KEY=' .env | cut -d= -f2-)
sleep 55
echo "=== catch-up ==="
curl -sS --max-time 40 -X POST -H "X-Auth-Bypass-Key: $KEY" \
  http://127.0.0.1:3000/api/accounts/catch-up-all
echo
sleep 80

echo "=== SCORE ==="
AUDIT_FIX_SINCE='2026-10-27 15:30:00' node scripts/_audit_10of10_score.js

echo "=== gaps hard ==="
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [gap] = await db.execute(`SELECT cm.account_id, LEFT(cm.content,60) c, cm.created_at,
    TIMESTAMPDIFF(MINUTE, cm.created_at, NOW()) age_m
    FROM conversation_messages cm JOIN accounts a ON a.id=cm.account_id
    WHERE cm.role='user' AND cm.created_at > NOW()-INTERVAL 3 HOUR
      AND a.is_autoreply_enabled=1 AND IFNULL(a.prompt,'')!=''
      AND a.session_string IS NOT NULL AND a.session_string!=''
      AND NOT EXISTS (SELECT 1 FROM conversation_messages x WHERE x.account_id=cm.account_id AND x.peer_id=cm.peer_id AND x.role='assistant' AND x.id>cm.id)
      AND NOT EXISTS (SELECT 1 FROM autoreply_disabled_peers ad WHERE ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id)
    ORDER BY cm.id DESC LIMIT 15`);
  console.log('gaps', gap.length);
  for (const r of gap) console.log(r.age_m + 'm', 'acc' + r.account_id, r.c);
  const [stubs] = await db.execute(`SELECT COUNT(*) c FROM conversation_messages WHERE role='assistant' AND created_at>='2026-10-27 15:40:00' AND TRIM(content) IN ('а ещё)','ага','ага)','круто)')`);
  console.log('new_stubs', stubs[0].c);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE

pm2 logs tgbot --err --lines 30 --nostream 2>/dev/null | grep -v telegramAuth | grep -iE 'isContradictory|not defined|Ошибка обработки' | tail -15 || echo 'no_pipeline_errors'
echo P0_PASS2_DONE
