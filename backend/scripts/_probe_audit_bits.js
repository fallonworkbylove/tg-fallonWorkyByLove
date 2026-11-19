#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');

(async () => {
  const [[nullImg]] = await db.execute(
    `SELECT COUNT(*) AS n FROM daily_photo_sends
     WHERE sent_at IS NOT NULL AND (image_file IS NULL OR image_file = '')`,
  );
  console.log('sent_null_image', nullImg.n);

  const [[withImg]] = await db.execute(
    `SELECT COUNT(*) AS n FROM daily_photo_sends
     WHERE sent_at IS NOT NULL AND image_file IS NOT NULL AND image_file <> ''`,
  );
  console.log('sent_with_image', withImg.n);

  const [orphans] = await db.execute(
    `SELECT d.account_id, COUNT(*) c FROM daily_photo_sends d
     LEFT JOIN accounts a ON a.id = d.account_id
     WHERE a.id IS NULL GROUP BY d.account_id`,
  );
  console.log('orphan_daily_photo_account_ids', orphans);

  const [msgOrphans] = await db.execute(
    `SELECT cm.account_id, COUNT(*) c FROM conversation_messages cm
     LEFT JOIN accounts a ON a.id = cm.account_id
     WHERE a.id IS NULL GROUP BY cm.account_id LIMIT 10`,
  );
  console.log('orphan_messages_sample', msgOrphans);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
