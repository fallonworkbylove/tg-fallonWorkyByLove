#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');

db.query(
  `SELECT id, phone, LEFT(system_prompt, 3500) AS p
   FROM accounts
   WHERE phone LIKE '%599307173%' OR phone LIKE '%79959307173%' OR id = 27
   ORDER BY id`,
)
  .then((r) => {
    for (const x of r.rows) {
      console.log('====', x.id, x.phone);
      console.log(x.p);
      console.log('');
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
