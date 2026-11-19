#!/bin/bash
set -e
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

echo "=== accounts (recent) ==="
node <<'NODE'
const db = require('./db');
(async () => {
  const [rows] = await db.execute(
    `SELECT id, phone,
            IF(session_string IS NULL OR session_string = '', 'empty', 'has_session') AS sess,
            created_at, updated_at
     FROM accounts
     ORDER BY id DESC
     LIMIT 15`,
  );
  for (const r of rows) {
    console.log(
      `#${r.id} ${r.phone} ${r.sess} created=${r.created_at} updated=${r.updated_at}`,
    );
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE

echo
echo "=== old startLogin (bak-outreach) ==="
sed -n '/async function startLogin/,/^async function confirmCode/p' \
  services/telegramClient.js.bak-outreach | head -40

echo
echo "=== current startLogin signature ==="
grep -n 'sendCode\|forceSMS\|connectionCandidates\|shuffle\|api_id=' services/telegramClient.js | head -25

echo
echo "=== historical login phrases in rotated logs ==="
for f in /root/.pm2/logs/tgbot-out__2026-10-1{2,3,4,5,6,7,8}*.log /root/.pm2/logs/tgbot-out.log; do
  [ -f "$f" ] || continue
  n=$(grep -acE '\[login\]|код запрошен|sendCode|Connect start' "$f" 2>/dev/null || echo 0)
  sms=$(grep -ac 'доставка: SMS' "$f" 2>/dev/null || echo 0)
  app=$(grep -ac 'доставка: приложение' "$f" 2>/dev/null || echo 0)
  echo "$(basename "$f"): loginish=$n sms=$sms app=$app"
done
