#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');

(async () => {
  const peer = '5484695633';
  const [rows] = await db.execute(
    `SELECT account_id, role, peer_username, content, created_at
     FROM conversation_messages
     WHERE peer_id = ?
     ORDER BY created_at ASC`,
    [peer],
  );
  // last 25 overall, prefer account with most recent
  const byAcc = {};
  for (const r of rows) {
    (byAcc[r.account_id] ||= []).push(r);
  }
  for (const [aid, list] of Object.entries(byAcc)) {
    console.log(`\n======== account_id=${aid} msgs=${list.length} ========`);
    const slice = list.slice(-20);
    for (const m of slice) {
      const t = new Date(m.created_at).toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const who = m.role === 'user' ? `@${m.peer_username || 'bun187'}` : 'БОТ';
      const text = String(m.content || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
      console.log(`[${t}] ${who}: ${text}`);
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
