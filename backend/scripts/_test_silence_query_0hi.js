require('dotenv').config();
const { findDbSilenceGaps, runSilenceCatchupHeal } = require('../services/silenceCatchup');

(async () => {
  const gaps = await findDbSilenceGaps({ maxAgeHours: 12, minAgeMin: 3, limit: 8 });
  console.log('GAPS', gaps.length);
  for (const g of gaps.slice(0, 5)) {
    console.log(
      g.account_id,
      g.peer_id,
      String(g.last_user_at),
      JSON.stringify(String(g.last_user_text || '').slice(0, 60)),
    );
  }
  // Don't run full heal here without telegramClient hooks — just query
  console.log('QUERY_OK');
  process.exit(0);
})().catch((e) => {
  console.error('QUERY_FAIL', e);
  process.exit(1);
});
