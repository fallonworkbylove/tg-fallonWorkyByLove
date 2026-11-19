require('dotenv').config();
const db = require('../db');
const fs = require('fs');

(async () => {
  const [kira] = await db.query(
    `SELECT id, phone, prompt FROM accounts WHERE phone LIKE '%9587381482%' OR prompt LIKE 'Ты — Кира%' LIMIT 1`,
  );
  const [vikaOther] = await db.query(
    `SELECT id, phone, LEFT(prompt, 200) AS p FROM accounts WHERE prompt LIKE 'Ты — Вика%' LIMIT 3`,
  );
  console.log('other vikas', JSON.stringify(vikaOther, null, 2));
  if (kira[0]?.prompt) {
    fs.writeFileSync('/tmp/kira_prompt.txt', kira[0].prompt);
    console.log('kira len', kira[0].prompt.length);
  }

  // Попробуем найти удалённый промпт в бинарных логах/бэкапах — нет.
  // Возьмём актуальный шаблон Киры и подставим данные Вики из известного куска.
  const [acc21] = await db.query(
    `SELECT id, phone, LENGTH(COALESCE(prompt,'')) plen, status, is_autoreply_enabled FROM accounts WHERE id=21 OR phone LIKE '%9959307173%' ORDER BY id DESC LIMIT 1`,
  );
  console.log('acc21', JSON.stringify(acc21, null, 2));

  const list = await fetch('http://127.0.0.1:3000/api/accounts').then((r) => r.json());
  const hit = (list.accounts || []).filter(
    (a) => a.id === 21 || String(a.phone || '').includes('7173'),
  );
  console.log(
    'live',
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
