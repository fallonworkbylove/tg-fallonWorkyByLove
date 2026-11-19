#!/bin/bash
set -euo pipefail
B=/root/opt/tgbot/tg-miniapp-loverussian
cd "$B/backend"

echo "=== export check ==="
node <<'NODE'
require('dotenv').config({ quiet: true });
// Don't load full telegramClient; just mediaSend
const m = require('./services/mediaSend');
console.log({
  isContradictoryMediaText: typeof m.isContradictoryMediaText,
  stripContradictoryMediaParts: typeof m.stripContradictoryMediaParts,
});
NODE

echo "=== error log times (last isContradictory) ==="
# pm2 error log may not have dates on every line; show surrounding
grep -n 'isContradictoryMediaText is not defined' /root/.pm2/logs/tgbot-error.log | tail -5
# file mtime / size
ls -la /root/.pm2/logs/tgbot-error.log
# count errors after restart: use pm2 dump start time
PID=$(pm2 pid tgbot)
START=$(ps -o lstart= -p "$PID" 2>/dev/null || true)
echo "tgbot_pid=$PID started=$START"

echo "=== fresh errors since process start (approx via tail -F snapshot) ==="
# Look at last 200 lines; if 'Ошибка обработки' appears with only old pattern, note
tail -200 /root/.pm2/logs/tgbot-error.log | grep -c 'isContradictoryMediaText is not defined' || true
tail -80 /root/.pm2/logs/tgbot-out.log | grep -iE 'Catch-up|подавил|Убрал отказ|Ошибка|gpt-4o|acc8|Машенька|Yulia' | tail -25

echo "=== why stale peers ==="
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const peers = [
    [23, '7123016992'],
    [10, '843157670'],
    [23, '8840759164'],
  ];
  for (const [acc, peer] of peers) {
    const [[ad]] = await db.execute(
      `SELECT 1 FROM autoreply_disabled_peers WHERE account_id=? AND peer_id=? LIMIT 1`,
      [acc, peer],
    );
    const [[bl]] = await db.execute(
      `SELECT 1 FROM blacklist WHERE account_id=? AND peer_id=? LIMIT 1`,
      [acc, peer],
    ).catch(() => [[{}]]);
    const [tail] = await db.execute(
      `SELECT role, LEFT(content,70) c, created_at FROM conversation_messages
       WHERE account_id=? AND peer_id=? ORDER BY id DESC LIMIT 4`,
      [acc, peer],
    );
    console.log(JSON.stringify({ acc, peer, paused: !!ad, bl: !!bl, tail }));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE
echo DIAG_DONE
