#!/usr/bin/env node
/**
 * Разовое сжатие accounts.id → 1..N (и всех FK).
 * Запуск на VPS: node scripts/_compact_account_ids.js
 */
require('dotenv').config();
const db = require('../db');
const { compactAccountIds } = require('../services/accountCleanup');

async function main() {
  const [before] = await db.execute('SELECT id, phone FROM accounts ORDER BY id');
  console.log('До:', before.map((r) => `${r.id}:${r.phone}`).join(', '));
  const mapping = await compactAccountIds();
  const [after] = await db.execute('SELECT id, phone FROM accounts ORDER BY id');
  console.log('После:', after.map((r) => `${r.id}:${r.phone}`).join(', '));
  console.log(
    'Маппинг:',
    mapping.size
      ? [...mapping.entries()].map(([a, b]) => `${a}→${b}`).join(', ')
      : '(без изменений)',
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
