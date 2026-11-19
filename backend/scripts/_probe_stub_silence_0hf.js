require('dotenv').config();
const db = require('../db');

(async () => {
  const [stubs] = await db.query(`
    SELECT id, account_id, peer_id, content, created_at
    FROM conversation_messages
    WHERE role = 'assistant'
      AND created_at > (NOW() - INTERVAL 24 HOUR)
      AND content IN ('ну да)', 'ок)', 'ладно)', 'ладно', 'ага)', 'поняла)', 'хах ну да)')
    ORDER BY id DESC
    LIMIT 12
  `);
  console.log('=== STUBS + prev user ===');
  for (const s of stubs) {
    const [[u]] = await db.query(
      `SELECT content FROM conversation_messages
       WHERE account_id=? AND peer_id=? AND role='user' AND id<?
       ORDER BY id DESC LIMIT 1`,
      [s.account_id, s.peer_id, s.id],
    );
    console.log(
      'STUB',
      s.account_id,
      JSON.stringify(s.content),
      '<=',
      JSON.stringify(u && u.content),
    );
  }

  console.log('=== VIDEO LIFE THREAD ===');
  const [th] = await db.query(
    `SELECT role, LEFT(content,180) c, created_at
     FROM conversation_messages
     WHERE account_id=27 AND peer_id=6868829215
     ORDER BY id DESC LIMIT 20`,
  );
  for (const r of th.reverse()) {
    console.log(String(r.created_at), r.role, JSON.stringify(r.c));
  }

  console.log('=== HITS club/vchera/video ===');
  const [hits] = await db.query(`
    SELECT account_id, peer_id, role, LEFT(content,140) c, created_at
    FROM conversation_messages
    WHERE created_at > (NOW() - INTERVAL 48 HOUR)
      AND (
        content LIKE '%клубняк%'
        OR content LIKE '%как и вчера%'
        OR content LIKE '%Как и вчера%'
        OR content LIKE '%видео записать%'
        OR content LIKE '%лайф%'
      )
    ORDER BY id DESC
    LIMIT 30
  `);
  for (const r of hits) {
    console.log(
      String(r.created_at),
      'acc' + r.account_id,
      r.peer_id,
      r.role,
      JSON.stringify(r.c),
    );
  }

  // why silence: check logs? pull last 3 gaps with more context
  console.log('=== CURRENT GAPS context ===');
  const gaps = [
    [36, 6005022669],
    [27, 8980903743],
    [36, 1464653518],
    [27, 6868829215],
  ];
  for (const [aid, peer] of gaps) {
    console.log(`\n-- gap acc${aid} peer${peer} --`);
    const [rows] = await db.query(
      `SELECT role, LEFT(content,160) c, created_at
       FROM conversation_messages
       WHERE account_id=? AND peer_id=?
       ORDER BY id DESC LIMIT 8`,
      [aid, peer],
    );
    for (const r of rows.reverse()) {
      console.log(String(r.created_at), r.role, JSON.stringify(r.c));
    }
  }

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
