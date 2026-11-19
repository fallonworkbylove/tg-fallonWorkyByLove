#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
cp /tmp/_ultra_hard_audit.js "$B/backend/scripts/"
cd "$B/backend"
KEY=$(grep '^TELEGRAM_AUTH_BYPASS_KEY=' .env | cut -d= -f2-)

curl -sS --max-time 45 -H "X-Auth-Bypass-Key: $KEY" \
  http://127.0.0.1:3000/api/accounts/pool-status > /tmp/pool.json || echo '{}' > /tmp/pool.json

node <<'NODE'
const fs = require('fs');
let j = {};
try { j = JSON.parse(fs.readFileSync('/tmp/pool.json', 'utf8')); } catch (_) {}
const ai = (j.accounts || []).filter((a) => a.ai && a.has_session);
console.log(JSON.stringify({
  online: j.online,
  pingOk: j.pingOk,
  ai_sess: ai.length,
  ai_online: ai.filter((a) => a.is_online).length,
  ai_ping: ai.filter((a) => a.ping_ok).length,
  offline_ai: ai.filter((a) => !a.is_online).map((a) => a.id),
}));
NODE

echo '---AUDIT---'
AUDIT_FIX_SINCE='2026-10-27 15:52:00' node scripts/_ultra_hard_audit.js | tee /tmp/ultra_audit.json.txt
echo '---AUDIT2---'
AUDIT_FIX_SINCE='2026-10-27 15:52:00' node scripts/_ultra_hard_audit.js | tail -20

echo '---ERR---'
pm2 logs tgbot --err --lines 50 --nostream 2>/dev/null | grep -v telegramAuth | grep -iE 'is not defined|TypeError|ReferenceError|Ошибка обработки' | tail -12 || echo clean_err

echo '---UI---'
grep -n 'app.js?v=\|updates.js?v=\|Полный разбор\|safeTelegramHref\|panel-tools' \
  "$B/frontend/index.html" "$B/frontend/updates.js" "$B/frontend/app.js" "$B/frontend/styles.css" | head -20

echo '---RECENT_REPLIES---'
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [rows] = await db.execute(`
    SELECT account_id, LEFT(content, 90) c, created_at
    FROM conversation_messages
    WHERE role='assistant' AND created_at >= '2026-10-27 15:52:00'
      AND content NOT LIKE '[медиа:%' AND content NOT LIKE '[голосовое:%'
    ORDER BY id DESC LIMIT 12`);
  for (const r of rows) console.log(String(r.created_at), 'acc'+r.account_id, JSON.stringify(r.c));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE
echo ULTRA_DONE
