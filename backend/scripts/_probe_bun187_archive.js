#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');

(async () => {
  const peer = '5484695633';
  const uname = 'bun187';

  const [arch] = await db.execute(
    `SELECT * FROM archived_peers WHERE peer_id = ? OR peer_id LIKE ?`,
    [peer, `%${peer}%`],
  ).catch((e) => {
    console.log('archived_peers err', e.message);
    return [[]];
  });
  console.log('archived_peers', arch);

  const [cleared] = await db.execute(
    `SELECT * FROM cleared_peers WHERE peer_id = ?`,
    [peer],
  ).catch(() => [[]]);
  console.log('cleared_peers', cleared);

  const [pause] = await db.execute(
    `SELECT * FROM autoreply_disabled_peers WHERE peer_id = ? ORDER BY id DESC`,
    [peer],
  ).catch(() => [[]]);
  console.log('autoreply_disabled', pause);

  const [flags] = await db.execute(
    `SELECT * FROM operator_lead_flags WHERE peer_id = ?`,
    [peer],
  ).catch(() => [[]]);
  console.log('operator_lead_flags', flags);

  // any archive-related tables
  const [tables] = await db.execute(`SHOW TABLES`);
  const names = tables.map((r) => Object.values(r)[0]);
  const archTables = names.filter((n) => /arch|blacklist|cleared|pause|disable/i.test(n));
  console.log('related_tables', archTables);

  for (const t of archTables) {
    try {
      const [rows] = await db.execute(
        `SELECT * FROM \`${t}\` WHERE peer_id = ? OR CAST(peer_id AS CHAR) = ? LIMIT 20`,
        [peer, peer],
      );
      if (rows.length) console.log(t, rows);
    } catch (e) {
      /* ignore */
    }
  }

  // last msgs per account
  const [sum] = await db.execute(
    `SELECT account_id,
            MAX(peer_username) uname,
            MAX(created_at) last_any,
            MAX(CASE WHEN role='user' THEN created_at END) last_user
     FROM conversation_messages
     WHERE peer_id = ? OR LOWER(peer_username)=?
     GROUP BY account_id`,
    [peer, uname],
  );
  console.log('dialogs', sum);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
