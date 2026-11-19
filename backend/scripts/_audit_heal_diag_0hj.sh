#!/bin/bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo "===== silenceCatchup errors ====="
grep -a 'silenceCatchup\|silence-heal' /root/.pm2/logs/tgbot-error.log | tail -25
echo "===== silence-heal out ====="
grep -a 'silence-heal\|silenceCatchup' /root/.pm2/logs/tgbot-out.log | tail -25
echo "===== file head ====="
sed -n '29,65p' services/silenceCatchup.js
echo "===== live query via node ====="
node scripts/_audit_heal_0hj.js 2>/dev/null | tail -40
echo "===== try heal once (log only path) ====="
node <<'NODE'
require('dotenv').config();
const { runSilenceCatchupHeal, healOneGap, findDbSilenceGaps } = require('./services/silenceCatchup');
(async () => {
  const gaps = await findDbSilenceGaps({ maxAgeHours: 12, minAgeMin: 1, limit: 10 });
  console.log('gaps', gaps.length);
  for (const g of gaps) {
    console.log('GAP', g.account_id, g.peer_id, g.peer_username, JSON.stringify(g.last_user_text));
  }
  // Don't call healOneGap without telegramClient hooks — just status
  const r = await runSilenceCatchupHeal({ limit: 3 });
  console.log('heal_result', r);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE
