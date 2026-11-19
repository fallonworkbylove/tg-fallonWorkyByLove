/**
 * Force silence catchup heal for stale unanswered gaps (AI on).
 */
require('dotenv').config({ quiet: true });

(async () => {
  const silence = require('../services/silenceCatchup');
  const r = await silence.runSilenceCatchupHeal({ limit: 20 });
  console.log('HEAL_RESULT', JSON.stringify(r));
  process.exit(0);
})().catch((e) => {
  console.error('HEAL_FAIL', e.message);
  process.exit(1);
});
