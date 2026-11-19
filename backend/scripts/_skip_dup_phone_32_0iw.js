#!/usr/bin/env node
'use strict';
/**
 * id=32 дубль телефона +79149759457 с id=30 → AUTH_KEY_DUPLICATED.
 * Чистим session у 32, оставляем 30.
 */
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
    `SELECT id, phone, status, LEFT(session_string, 20) AS s
     FROM accounts WHERE phone = '+79149759457' ORDER BY id`,
  );
  console.log('before', rows);
  const keep = 30;
  const drop = 32;
  const [r] = await db.execute(
    `UPDATE accounts
     SET session_string = '', status = 'Нужна авторизация', is_autoreply_enabled = 0
     WHERE id = ? AND phone = '+79149759457'`,
    [drop],
  );
  console.log('cleared_id', drop, 'affected', r.affectedRows, 'keep', keep);
  const [after] = await db.execute(
    `SELECT id, phone, status, LENGTH(session_string) AS len FROM accounts WHERE id IN (30, 32)`,
  );
  console.log('after', after);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
