/**
 * Перелогин Вики +79959307173 (accounts.id=2, user_id=3).
 * Код запрашиваем через loginAuth ВНУТРИ процесса pm2 нельзя —
 * поэтому дергаем HTTP API бота (pending живёт в tgbot).
 *
 * Usage:
 *   node scripts/_relgin_7173.js start
 *   node scripts/_relgin_7173.js code 12345
 *   node scripts/_relgin_7173.js password 'cloudpass'
 */
require('dotenv').config();
const db = require('../db');

const PHONE = '+79959307173';
const ACCOUNT_ID = 2;
const API = process.env.RELOGIN_API || 'http://127.0.0.1:3000';

async function api(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const bypassKey = String(process.env.TELEGRAM_AUTH_BYPASS_KEY || '').trim();
  if (bypassKey) headers['X-Auth-Bypass-Key'] = bypassKey;
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  console.log(res.status, JSON.stringify(json, null, 2));
  return { status: res.status, json };
}

(async () => {
  const cmd = process.argv[2] || 'start';
  const arg = process.argv[3] || '';

  const [users] = await db.query(
    `SELECT u.id, u.telegram_user_id, u.username
     FROM users u
     WHERE u.id = 3 OR u.telegram_user_id = ?
     ORDER BY u.id LIMIT 5`,
    [process.env.ADMIN_ALERT_CHAT_ID || '8588744561'],
  );
  console.log('users', JSON.stringify(users, null, 2));

  const [acc] = await db.query(
    `SELECT id, user_id, phone, LENGTH(session_string) AS sess_len, status, is_autoreply_enabled
     FROM accounts WHERE id = ?`,
    [ACCOUNT_ID],
  );
  console.log('account', JSON.stringify(acc[0], null, 2));

  if (cmd === 'start') {
    await api('/api/accounts/connect/start', { phone: PHONE });
    console.log('CODE_PENDING — смотри код в Telegram на +79959307173 и пришли цифры.');
  } else if (cmd === 'code') {
    if (!/^\d{4,8}$/.test(arg)) {
      console.error('usage: node scripts/_relgin_7173.js code 12345');
      process.exit(1);
    }
    // prompt пустой → saveSession не затрёт промпт
    const r = await api('/api/accounts/connect/code', {
      phone: PHONE,
      code: arg,
      prompt: '',
    });
    if (r.json?.status === 'needPassword') {
      console.log('NEED_2FA — пришли: node scripts/_relgin_7173.js password \'...\'');
    } else if (r.json?.success) {
      // Нормализуем phone в БД и убеждаемся что обновился именно id=2
      await db.query(
        `UPDATE accounts SET phone = ?, status = 'AI включен' WHERE id = ? AND user_id = ?`,
        [PHONE, ACCOUNT_ID, acc[0].user_id],
      );
      const [check] = await db.query(
        `SELECT id, phone, LENGTH(session_string) AS sess_len, status, is_autoreply_enabled
         FROM accounts WHERE id = ?`,
        [ACCOUNT_ID],
      );
      console.log('updated', JSON.stringify(check[0], null, 2));
    }
  } else if (cmd === 'password') {
    if (!arg) {
      console.error('usage: node scripts/_relgin_7173.js password \'cloud\'');
      process.exit(1);
    }
    const r = await api('/api/accounts/connect/password', {
      phone: PHONE,
      password: arg,
      prompt: '',
    });
    if (r.json?.success) {
      await db.query(
        `UPDATE accounts SET phone = ?, status = 'AI включен', is_autoreply_enabled = 1
         WHERE id = ?`,
        [PHONE, ACCOUNT_ID],
      );
      // Реактивируем AI
      await api(`/api/accounts/${ACCOUNT_ID}/start-ai`, {});
      const [check] = await db.query(
        `SELECT id, phone, LENGTH(session_string) AS sess_len, status, is_autoreply_enabled
         FROM accounts WHERE id = ?`,
        [ACCOUNT_ID],
      );
      console.log('updated', JSON.stringify(check[0], null, 2));
    }
  } else {
    console.error('unknown cmd', cmd);
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
