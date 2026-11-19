#!/usr/bin/env node
require('dotenv').config({ quiet: true });
const db = require('../db');
const { nameFromPrompt } = require('../services/adminConsoleStats');

(async () => {
  const [rows] = await db.execute(
    `SELECT id, phone, prompt, is_autoreply_enabled, status
     FROM accounts WHERE id IN (31, 41, 46, 48) ORDER BY id`,
  );
  for (const r of rows) {
    const name = nameFromPrompt(r.prompt) || '—';
    console.log(
      `#${r.id} · ${name} · ${r.phone} · AI ${r.is_autoreply_enabled ? 'on' : 'off'} · ${r.status || '—'}`,
    );
  }
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
