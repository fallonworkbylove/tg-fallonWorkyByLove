#!/usr/bin/env node
require('dotenv').config({ quiet: true });
const db = require('../db');
(async () => {
  const [r] = await db.execute(`
    SELECT LEFT(content,60) c, created_at, account_id
    FROM conversation_messages
    WHERE role='assistant' AND created_at > NOW()-INTERVAL 48 HOUR
      AND TRIM(content) IN ('а ещё)','а ещё','ага','ага)','круто)','круто','ну да)','хм ок','хм ок)','ладно')
    ORDER BY id DESC LIMIT 12`);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
