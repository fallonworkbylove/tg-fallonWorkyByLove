#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');

(async () => {
  const [accounts] = await db.execute('SELECT id, phone FROM accounts ORDER BY id');
  console.log(
    'accounts:',
    accounts.map((r) => `${r.id}:${r.phone}`).join(' | '),
  );

  const [byAcc] = await db.execute(
    `SELECT account_id, COUNT(*) AS c,
            SUM(sent_at IS NOT NULL) AS sent
     FROM daily_photo_sends GROUP BY account_id`,
  );
  console.log('daily_photo_sends by account:', JSON.stringify(byAcc));

  const [recent] = await db.execute(
    `SELECT account_id, peer_id, image_file, sent_at
     FROM daily_photo_sends
     WHERE sent_at IS NOT NULL
     ORDER BY sent_at DESC LIMIT 20`,
  );
  console.log('recent sent:', JSON.stringify(recent, null, 2));

  const [[total]] = await db.execute(
    `SELECT COUNT(*) AS n FROM daily_photo_sends WHERE sent_at IS NOT NULL`,
  );
  console.log('total sent rows:', total.n);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
