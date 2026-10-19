#!/usr/bin/env node
/**
 * Пересчёт accounts.seq (1…N внутри каждого user_id). PK id не трогаем.
 * Запуск на VPS: node scripts/_compact_account_ids.js
 */
require('dotenv').config();
const db = require('../db');
const { ensureAccountSeqSchema, renumberAccountSeq } = require('../services/accountCleanup');

async function main() {
  await ensureAccountSeqSchema();
  await renumberAccountSeq();
  const [rows] = await db.execute(
    'SELECT id, seq, user_id, phone FROM accounts ORDER BY user_id, seq, id',
  );
  console.log(
    rows.map((r) => `u${r.user_id} #${r.seq} id=${r.id} ${r.phone}`).join('\n') ||
      '(пусто)',
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
