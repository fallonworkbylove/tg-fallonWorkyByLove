#!/bin/bash
set -euo pipefail
echo "err_count=$(grep -c 'isContradictoryMediaText is not defined' /root/.pm2/logs/tgbot-error.log || true)"
ls -la --time-style=long-iso /root/.pm2/logs/tgbot-error.log
PID=$(pm2 pid tgbot)
echo "pid=$PID etime=$(ps -p "$PID" -o etime= 2>/dev/null || echo '?')"
echo "=== last error lines ==="
tail -25 /root/.pm2/logs/tgbot-error.log | grep -v telegramAuth | tail -15
echo "=== recent out ==="
tail -60 /root/.pm2/logs/tgbot-out.log | grep -iE 'Ошибка обработки|Catch-up:|Убрал отказ|isContradictory|gpt-4o-mini' | tail -20

cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const peers = [[23, '7123016992'], [10, '843157670'], [23, '8840759164']];
  for (const [acc, peer] of peers) {
    const [paused] = await db.execute(
      `SELECT 1 AS x FROM autoreply_disabled_peers WHERE account_id=? AND peer_id=? LIMIT 1`,
      [acc, peer],
    );
    let archived = [];
    try {
      [archived] = await db.execute(
        `SELECT 1 AS x FROM archived_peers WHERE account_id=? AND peer_id=? LIMIT 1`,
        [acc, peer],
      );
    } catch (_) {}
    const [tail] = await db.execute(
      `SELECT role, LEFT(content,65) c, created_at FROM conversation_messages
       WHERE account_id=? AND peer_id=? ORDER BY id DESC LIMIT 3`,
      [acc, peer],
    );
    console.log(JSON.stringify({
      acc, peer,
      paused: paused.length > 0,
      archived: archived.length > 0,
      tail: tail.map((t) => ({ role: t.role, c: t.c, at: String(t.created_at) })),
    }));
  }
  // fresh gaps only < 5 min vs stale
  const [gap] = await db.execute(`SELECT cm.account_id, cm.peer_id, LEFT(cm.content,50) c,
    TIMESTAMPDIFF(MINUTE, cm.created_at, NOW()) age_m
    FROM conversation_messages cm JOIN accounts a ON a.id=cm.account_id
    WHERE cm.role='user' AND cm.created_at > NOW()-INTERVAL 3 HOUR
      AND a.is_autoreply_enabled=1 AND IFNULL(a.prompt,'')!=''
      AND NOT EXISTS (SELECT 1 FROM conversation_messages x WHERE x.account_id=cm.account_id AND x.peer_id=cm.peer_id AND x.role='assistant' AND x.id>cm.id)
      AND NOT EXISTS (SELECT 1 FROM autoreply_disabled_peers ad WHERE ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id)
      AND TIMESTAMPDIFF(MINUTE, cm.created_at, NOW()) >= 10
    ORDER BY cm.created_at ASC`);
  console.log('stale_gaps_ge10m', gap.length);
  for (const g of gap) console.log(g.age_m + 'm', 'acc' + g.account_id, g.peer_id, g.c);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE
echo DIAG2_DONE
