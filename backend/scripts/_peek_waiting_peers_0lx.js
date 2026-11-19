#!/usr/bin/env node
require('dotenv').config({ quiet: true });
const db = require('../db');

const peers = [
  [54, '380665174', 'mishaitsme'],
  [54, '836200206', 'Bulletvks'],
  [42, '1969676569', 'zin_ter_ishka'],
  [41, '987983594', 'Bksmx'],
  [52, '582209724', 'alonering'],
  [41, '1285158074', 'Valhalla_athlet'],
];

(async () => {
  for (const [a, p, name] of peers) {
    const [rows] = await db.query(
      `SELECT role, LEFT(content, 60) AS c, created_at
       FROM conversation_messages
       WHERE account_id = ? AND peer_id = ?
       ORDER BY id DESC LIMIT 4`,
      [a, p],
    );
    console.log('---', a, name, p);
    for (const r of rows) {
      console.log(
        r.role,
        r.created_at,
        String(r.c || '').replace(/\s+/g, ' '),
      );
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
