require('dotenv').config();
const db = require('../db');
const fs = require('fs');

(async () => {
  // Промпт вытащим из файла, если передан; иначе короткий из бэкапа транскрипта.
  const fromFile = process.argv[2];
  let prompt = fromFile ? fs.readFileSync(fromFile, 'utf8') : '';

  const [rows] = await db.query(
    `SELECT id, phone, LENGTH(prompt) AS plen, status, is_autoreply_enabled
     FROM accounts WHERE phone LIKE '%9959307173%' OR id = 21 ORDER BY id DESC LIMIT 3`,
  );
  console.log('before', JSON.stringify(rows, null, 2));
  if (!rows.length) process.exit(1);

  if (!prompt) {
    console.log('NO_PROMPT_FILE — only enabling AI');
  } else {
    await db.query(`UPDATE accounts SET prompt = ? WHERE id = ?`, [prompt, rows[0].id]);
  }
  await db.query(
    `UPDATE accounts SET status = 'AI включен', is_autoreply_enabled = 1, phone = '+79959307173' WHERE id = ?`,
    [rows[0].id],
  );

  const res = await fetch(`http://127.0.0.1:3000/api/accounts/${rows[0].id}/start-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  console.log('start-ai', res.status, await res.text());

  const list = await fetch('http://127.0.0.1:3000/api/accounts').then((r) => r.json());
  const hit = (list.accounts || []).filter((a) => a.id === rows[0].id);
  console.log(
    'after',
    JSON.stringify(
      hit.map((a) => ({
        id: a.id,
        phone: a.phone,
        online: a.is_online,
        status: a.status,
        ai: a.is_autoreply_enabled,
        promptLen: (a.prompt || '').length,
      })),
      null,
      2,
    ),
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
