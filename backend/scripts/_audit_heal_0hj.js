#!/usr/bin/env node
require('dotenv').config();
const {
  findDbSilenceGaps,
  runSilenceCatchupHeal,
} = require('../services/silenceCatchup');

(async () => {
  const gaps = await findDbSilenceGaps({ maxAgeHours: 12, minAgeMin: 1, limit: 20 });
  console.log('findDbSilenceGaps', gaps.length);
  console.log(JSON.stringify(gaps.slice(0, 15), null, 2));

  // dry: why video-life peer specifically
  const hit = gaps.find(
    (g) =>
      String(g.peer_id) === '6868829215' ||
      /лайф|видео/i.test(String(g.last_text || g.txt || '')),
  );
  console.log('video_life_in_gaps', Boolean(hit), hit || null);

  // Don't actually heal aggressively in audit — just report what heal would see
  console.log('--- heal dry call (limit 0 via night?) ---');
  const { isNightTextQuietHour } = require('../services/timing');
  console.log('isNightTextQuietHour', isNightTextQuietHour());
  const hour = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' }),
  ).getHours();
  console.log('msk_hour', hour);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
