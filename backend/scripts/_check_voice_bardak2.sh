#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo "=== bardak voice/outbound ==="
grep -aE 'bardak0528' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | grep -iE 'voice|голос|voprosy|Заготовка|outbound|Ответ|сон|подъём|после' | tail -40 || true
echo
echo "=== first bardak lines ==="
grep -aE 'bardak0528' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | head -50 || true
echo
echo "=== voprosy files ==="
find /root/opt/tgbot/tg-miniapp-loverussian -name 'voprosy.ogg' 2>/dev/null | while read -r f; do
  echo "FILE $f"
  ls -la "$f"
  ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$f" 2>/dev/null || echo "no ffprobe"
done
echo
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [rows] = await db.execute(
    `SELECT account_id, peer_id, peer_username, role, LEFT(content,200) content, created_at
     FROM conversation_messages
     WHERE peer_username LIKE '%bardak%'
     ORDER BY id ASC LIMIT 50`
  );
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE
