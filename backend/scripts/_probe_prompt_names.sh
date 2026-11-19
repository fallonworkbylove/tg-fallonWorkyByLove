#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node <<'NODE'
require('dotenv').config();
const db = require('./db');
(async () => {
  const [rows] = await db.execute(
    `SELECT id, phone, LEFT(prompt, 400) AS p
     FROM accounts
     WHERE COALESCE(prompt,'') != ''
     ORDER BY id
     LIMIT 20`,
  );
  for (const r of rows) {
    console.log('---', r.id, r.phone);
    console.log(String(r.p || '').replace(/\s+/g, ' ').slice(0, 320));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE
