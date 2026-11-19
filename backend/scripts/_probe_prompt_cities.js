#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');

(async () => {
  const [rows] = await db.query(`
    SELECT id, phone,
           LEFT(COALESCE(prompt,''), 140) AS head,
           CHAR_LENGTH(COALESCE(prompt,'')) AS len
    FROM accounts
    WHERE prompt LIKE '%Красноярск%'
       OR prompt LIKE '%Новгород%'
       OR prompt LIKE '%Анапа%'
       OR prompt LIKE '%Великий%'
       OR prompt LIKE '%Маша%'
       OR prompt LIKE '%Настя%'
       OR prompt LIKE '%Вика%'
    ORDER BY id
    LIMIT 30
  `);
  console.log('HITS', JSON.stringify(rows, null, 2));

  const [sample] = await db.query(`
    SELECT id, phone, prompt
    FROM accounts
    WHERE phone LIKE '%599307173%' OR phone LIKE '%9959307173%'
    ORDER BY id DESC
    LIMIT 1
  `);
  if (sample[0]) {
    console.log('\n==== VIKA', sample[0].id, sample[0].phone, 'len', String(sample[0].prompt || '').length, '====\n');
    console.log(String(sample[0].prompt || ''));
  }

  // longest prompts as style refs
  const [top] = await db.query(`
    SELECT id, phone, CHAR_LENGTH(prompt) AS len
    FROM accounts
    WHERE prompt IS NOT NULL AND prompt <> ''
    ORDER BY CHAR_LENGTH(prompt) DESC
    LIMIT 5
  `);
  console.log('\nLONGEST', JSON.stringify(top, null, 2));
  if (top[0]) {
    const [full] = await db.query(`SELECT id, phone, prompt FROM accounts WHERE id = ?`, [top[0].id]);
    console.log('\n==== LONGEST FULL', full[0].id, full[0].phone, '====\n');
    console.log(String(full[0].prompt || '').slice(0, 7000));
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
