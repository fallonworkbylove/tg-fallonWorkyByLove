require('dotenv').config();
const db = require('../db');

(async () => {
  const [rows] = await db.query(
    `SELECT id, user_id, phone, LENGTH(session_string) AS sess_len, status, is_autoreply_enabled,
            LEFT(COALESCE(prompt,''), 40) AS prompt
     FROM accounts
     WHERE phone LIKE '%9959307173%' OR phone LIKE '%995%930%' OR phone LIKE '%7173%'
        OR REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'+','') LIKE '%9959307173%'
     ORDER BY id`,
  );
  console.log('by phone', JSON.stringify(rows, null, 2));

  const [all] = await db.query(
    `SELECT id, user_id, phone, LENGTH(session_string) AS sess_len, status, is_autoreply_enabled
     FROM accounts WHERE user_id = 3 ORDER BY id`,
  );
  console.log('user3', JSON.stringify(all, null, 2));

  // Найдём аккаунт Вики по промпту если phone съехал
  const [vika] = await db.query(
    `SELECT id, user_id, phone, LENGTH(session_string) AS sess_len, status, is_autoreply_enabled
     FROM accounts WHERE prompt LIKE 'Ты — Вика, 24%' ORDER BY id`,
  );
  console.log('vika24', JSON.stringify(vika, null, 2));

  const target =
    rows.find((r) => String(r.phone).replace(/\D/g, '').endsWith('9959307173') || String(r.phone).replace(/\D/g, '').endsWith('7173')) ||
    vika[0] ||
    rows[0];

  if (!target) {
    console.log('NO_TARGET');
    process.exit(1);
  }

  await db.query(
    `UPDATE accounts SET phone = '+79959307173', status = 'AI включен', is_autoreply_enabled = 1 WHERE id = ?`,
    [target.id],
  );

  // Если saveSession создал дубль — смержим сессию в id=2 если он есть
  const [id2] = await db.query(`SELECT id, phone, LENGTH(session_string) AS sess_len, prompt IS NOT NULL AS has_prompt FROM accounts WHERE id = 2`);
  console.log('id2', JSON.stringify(id2, null, 2));

  if (id2[0] && target.id !== 2) {
    const [sess] = await db.query(`SELECT session_string FROM accounts WHERE id = ?`, [target.id]);
    if (sess[0]?.session_string) {
      await db.query(
        `UPDATE accounts SET phone = '+79959307173', session_string = ?, status = 'AI включен', is_autoreply_enabled = 1 WHERE id = 2`,
        [sess[0].session_string],
      );
      console.log('copied session to id=2');
    }
  }

  const res = await fetch(`http://127.0.0.1:3000/api/accounts/${target.id === 2 ? 2 : target.id}/start-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const text = await res.text();
  console.log('start-ai', res.status, text);

  const checkRes = await fetch('http://127.0.0.1:3000/api/accounts');
  const j = await checkRes.json();
  const arr = j.accounts || [];
  const hit = arr.filter(
    (a) => a.id === 2 || a.id === target.id || String(a.phone || '').includes('7173') || String(a.phone || '').includes('995930'),
  );
  console.log('online', JSON.stringify(hit.map((a) => ({ id: a.id, phone: a.phone, is_online: a.is_online, status: a.status, ai: a.is_autoreply_enabled })), null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
