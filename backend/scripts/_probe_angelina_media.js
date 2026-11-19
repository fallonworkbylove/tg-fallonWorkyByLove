/* Probe Angelina media link + recent logs clues */
require('dotenv').config();
const db = require('../db');

(async () => {
  const [accs] = await db.execute(
    `SELECT id, phone, name, media_chat_link, media_link, prompt
     FROM accounts
     WHERE phone LIKE '%79324437506%'
        OR phone LIKE '%9324437506%'
        OR LOWER(COALESCE(name,'')) LIKE '%ангелин%'
        OR LOWER(COALESCE(name,'')) LIKE '%angelin%'
     LIMIT 10`,
  );
  console.log('accounts cols probe…');
  // schema may differ — try flexible
  const [cols] = await db.execute(`SHOW COLUMNS FROM accounts`);
  const names = cols.map((c) => c.Field);
  console.log(
    'media-ish cols:',
    names.filter((n) => /media|link|channel|invite/i.test(n)),
  );

  const mediaCols = names.filter((n) => /media|link|channel|invite/i.test(n));
  const selectCols = ['id', 'phone', 'name', ...mediaCols].filter((c, i, a) => a.indexOf(c) === i && names.includes(c));
  const [rows] = await db.execute(
    `SELECT ${selectCols.join(', ')}
     FROM accounts
     WHERE phone LIKE '%9324437506%'
        OR LOWER(COALESCE(name,'')) LIKE '%ангелин%'
        OR LOWER(COALESCE(name,'')) LIKE '%крылов%'
     LIMIT 10`,
  );
  console.log(JSON.stringify(rows, null, 2));

  // peer history tags
  if (rows[0]) {
    const aid = rows[0].id;
    try {
      const [msgs] = await db.execute(
        `SELECT role, LEFT(content, 160) AS c, created_at
         FROM messages
         WHERE account_id = ? AND peer_id = ?
         ORDER BY id DESC LIMIT 25`,
        [aid, '665924948'],
      );
      console.log('recent msgs:', JSON.stringify(msgs, null, 2));
    } catch (e) {
      console.log('msgs err', e.message);
      try {
        const [msgs] = await db.execute(
          `SELECT role, LEFT(text, 160) AS c, created_at
           FROM chat_messages
           WHERE account_id = ? AND peer_id = ?
           ORDER BY id DESC LIMIT 25`,
          [aid, '665924948'],
        );
        console.log('chat_messages:', JSON.stringify(msgs, null, 2));
      } catch (e2) {
        console.log('chat_messages err', e2.message);
      }
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
