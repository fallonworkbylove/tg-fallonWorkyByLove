require('dotenv').config();
const db = require('../db');

(async () => {
  const [[kira]] = await db.query(
    `SELECT prompt FROM accounts WHERE prompt LIKE 'Ты — Кира, 24%' LIMIT 1`,
  );
  if (!kira?.prompt) {
    console.error('no kira prompt');
    process.exit(1);
  }

  let prompt = kira.prompt;
  // Кира: Липецк → Донецк (Украина). Вика: Липецк → Тимашевск (Россия).
  prompt = prompt.replace(/Ты — Кира,/g, 'Ты — Вика,');
  prompt = prompt.replace(/Кира/g, 'Вика');
  prompt = prompt.replace(/Донецк \(Украина\)/g, 'Тимашевск (Россия)');
  prompt = prompt.replace(/в Донецк/g, 'в Тимашевск');
  prompt = prompt.replace(/Донецке/g, 'Тимашевске');
  prompt = prompt.replace(/Донецк/g, 'Тимашевск');
  prompt = prompt.replace(/Украин[аеуы]?/gi, (m) => {
    // только в контексте страны переезда уже заменили; остальное про Украину у Киры убрать осторожно
    return m;
  });
  // Страна мамы / переезда
  prompt = prompt.replace(/\(Украина\)/g, '(Россия)');

  const [[acc]] = await db.query(
    `SELECT id FROM accounts WHERE phone LIKE '%9959307173%' OR id = 21 ORDER BY id DESC LIMIT 1`,
  );
  if (!acc) {
    console.error('no account');
    process.exit(1);
  }

  await db.query(
    `UPDATE accounts SET prompt = ?, status = 'AI включен', is_autoreply_enabled = 1 WHERE id = ?`,
    [prompt, acc.id],
  );
  console.log('restored prompt len', prompt.length, 'to id', acc.id);
  console.log('head', prompt.slice(0, 220).replace(/\n/g, ' | '));

  const res = await fetch(`http://127.0.0.1:3000/api/accounts/${acc.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  console.log('put', res.status, (await res.text()).slice(0, 200));

  // soft restart AI to pick prompt
  await fetch(`http://127.0.0.1:3000/api/accounts/${acc.id}/stop-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const start = await fetch(`http://127.0.0.1:3000/api/accounts/${acc.id}/start-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  console.log('start-ai', start.status, await start.text());

  const list = await fetch('http://127.0.0.1:3000/api/accounts').then((r) => r.json());
  const hit = (list.accounts || []).find((a) => a.id === acc.id);
  console.log({
    id: hit?.id,
    online: hit?.is_online,
    status: hit?.status,
    ai: hit?.is_autoreply_enabled,
    promptLen: (hit?.prompt || '').length,
    promptHead: String(hit?.prompt || '').slice(0, 120),
  });
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
