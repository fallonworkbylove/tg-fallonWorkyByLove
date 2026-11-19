#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const db = require('../db');

(async () => {
  const [rows] = await db.query(
    `SELECT id, phone, prompt FROM accounts WHERE id IN (17, 29) ORDER BY id`,
  );
  for (const r of rows) {
    const path = `/tmp/prompt_${r.id}.txt`;
    fs.writeFileSync(path, String(r.prompt || ''), 'utf8');
    console.log('wrote', path, 'len', String(r.prompt || '').length, r.phone);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
