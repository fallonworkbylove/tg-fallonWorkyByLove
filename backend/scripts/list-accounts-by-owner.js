/**
 * Показывает, к какому пользователю Mini App привязаны номера.
 *
 *   node scripts/list-accounts-by-owner.js
 *   node scripts/list-accounts-by-owner.js --today   # + счётчик ответов ИИ за сегодня
 *   node scripts/list-accounts-by-owner.js --all     # + счётчик ответов ИИ за всё время
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const wantToday = process.argv.includes('--today');
const wantAll = process.argv.includes('--all') || (!wantToday && process.argv.includes('--ai'));

function ownerLabel(row) {
  const username = String(row.username || '').trim();
  const firstName = String(row.first_name || '').trim();
  if (username) return username;
  if (firstName) return firstName;
  return `user#${row.user_id}`;
}

function fmtPhone(phone) {
  return String(phone || '').replace(/\s+/g, '');
}

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  let aiJoin = '';
  if (wantToday) {
    aiJoin = `
      LEFT JOIN conversation_messages cm
        ON cm.account_id = a.id
       AND cm.role = 'assistant'
       AND cm.created_at >= CURDATE()`;
  } else if (wantAll) {
    aiJoin = `
      LEFT JOIN conversation_messages cm
        ON cm.account_id = a.id
       AND cm.role = 'assistant'`;
  }

  const [rows] = await db.query(`
    SELECT
      u.id AS user_id,
      u.username,
      u.first_name,
      a.id AS account_id,
      a.phone,
      a.status,
      a.is_autoreply_enabled
      ${wantToday || wantAll ? ', COUNT(cm.id) AS ai_messages' : ''}
    FROM accounts a
    JOIN users u ON u.id = a.user_id
    ${aiJoin}
    GROUP BY u.id, u.username, u.first_name, a.id, a.phone, a.status, a.is_autoreply_enabled
    ORDER BY COALESCE(NULLIF(u.username, ''), NULLIF(u.first_name, ''), CAST(u.id AS CHAR)), a.phone
  `);

  const byOwner = new Map();
  for (const row of rows) {
    const label = ownerLabel(row);
    if (!byOwner.has(label)) byOwner.set(label, []);
    byOwner.get(label).push(row);
  }

  console.log('');
  for (const [label, accounts] of byOwner) {
    const phones = accounts.map((a) => `"${fmtPhone(a.phone)}"`).join(', ');
    console.log(`${label} — ${phones}`);
  }

  if (wantToday || wantAll) {
    console.log('');
    console.log(wantToday ? 'Ответы ИИ за сегодня:' : 'Ответы ИИ за всё время:');
    console.table(
      rows.map((r) => ({
        owner: ownerLabel(r),
        id: r.account_id,
        phone: fmtPhone(r.phone),
        ai_messages: Number(r.ai_messages) || 0,
        ai: r.is_autoreply_enabled ? 'on' : 'off',
        status: r.status,
      })),
    );
  }

  await db.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
