#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');

(async () => {
  const [[o]] = await db.execute(
    `SELECT COUNT(*) AS n FROM conversation_messages cm
     LEFT JOIN accounts a ON a.id = cm.account_id
     WHERE a.id IS NULL`,
  );
  console.log('orphan_messages_total', o.n);

  const [[a]] = await db.execute('SELECT COUNT(*) AS n FROM conversation_messages');
  console.log('messages_total', a.n);

  const [[live]] = await db.execute(
    `SELECT COUNT(*) AS n FROM conversation_messages cm
     INNER JOIN accounts a ON a.id = cm.account_id`,
  );
  console.log('messages_with_live_account', live.n);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
