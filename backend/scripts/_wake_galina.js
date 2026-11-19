#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');
const { activateAccount, isActive, deactivateAccount } = require('../services/telegramClient');

(async () => {
  const [[acc]] = await db.execute(
    `SELECT id, phone, session_string, is_autoreply_enabled, status
     FROM accounts WHERE phone LIKE '%9601878670%' LIMIT 1`,
  );
  if (!acc) {
    console.error('NOT_FOUND');
    process.exit(1);
  }
  console.log('before', {
    id: acc.id,
    phone: acc.phone,
    ai: acc.is_autoreply_enabled,
    status: acc.status,
    active: isActive(acc.id),
    slen: (acc.session_string || '').length,
  });

  if (!acc.session_string) {
    console.error('NO_SESSION');
    process.exit(1);
  }

  // Поднимаем клиент в ЭТОМ процессе — но живой бот в pm2. Нужен restart
  // или HTTP-вызов activate. Здесь только диагностика + подсказка.
  // Для реального wake: дергаем activate через отдельный one-shot с тем же
  // кодом что bootstrap, но лучше pm2 restart после того как сессия на месте.

  const [all] = await db.execute(
    `SELECT id, phone, is_autoreply_enabled, status,
            CHAR_LENGTH(session_string) AS slen
     FROM accounts
     WHERE session_string IS NOT NULL AND session_string != ''
     ORDER BY id`,
  );
  console.log('ALL_WITH_SESSION', all);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
