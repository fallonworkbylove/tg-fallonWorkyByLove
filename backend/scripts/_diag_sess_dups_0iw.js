#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '../.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
}
const db = require('../db');

(async () => {
  const [rows] = await db.execute(
    `SELECT id, phone, LEFT(session_string, 28) AS s, LENGTH(session_string) AS len, status
     FROM accounts
     WHERE session_string IS NOT NULL AND session_string != ''
     ORDER BY id`,
  );
  console.log('accounts_with_session', rows.length);
  for (const r of rows) console.log(r.id, r.phone, r.len, r.status, r.s);

  const [dups] = await db.execute(
    `SELECT LEFT(session_string, 40) AS ss, COUNT(*) AS c, GROUP_CONCAT(id) AS ids, GROUP_CONCAT(phone) AS phones
     FROM accounts
     WHERE session_string IS NOT NULL AND session_string != ''
     GROUP BY session_string
     HAVING c > 1`,
  );
  console.log('SESSION_DUPS', JSON.stringify(dups));

  const [phoneDups] = await db.execute(
    `SELECT phone, COUNT(*) AS c, GROUP_CONCAT(id) AS ids
     FROM accounts
     GROUP BY phone
     HAVING c > 1`,
  );
  console.log('PHONE_DUPS', JSON.stringify(phoneDups));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
