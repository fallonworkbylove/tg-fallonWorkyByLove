#!/usr/bin/env node
/**
 * Убирает из промптов аккаунтов формулировку «вместе глянем» без ссылки.
 * Также режем похожие «давай вместе посмотрим / глянем на платформе».
 */
require('dotenv').config();
const db = require('../db');

const OLD_DAY3 =
  /Сама упомяни:[^\n]*глянем[^\n]*/gi;

const NEW_DAY3 =
  'Сама упомяни мягко про платформу/коллекцию без «давай вместе глянем» и без обещания ссылки, пока ссылки нет: «кстати, сегодня залетела на платформу, там новая коллекция выходит, я уже присматриваю)»';

const PHRASE_FIXES = [
  [
    /кстати,?\s*сегодня\s+залетела\s+на\s+платформу,\s*там\s+новая\s+коллекция\s+выходит,\s*может\s+вместе\s+глянем\?\s*я\s+уже\s+присматриваю\)*/gi,
    'кстати, сегодня залетела на платформу, там новая коллекция выходит, я уже присматриваю)',
  ],
  [/может\s+вместе\s+глянем\??/gi, ''],
  [/давай\s+вместе\s+(?:глянем|посмотрим)\??/gi, ''],
  [/вместе\s+глянем\??/gi, ''],
];

function patchPrompt(prompt) {
  let out = String(prompt || '');
  const before = out;
  if (OLD_DAY3.test(out)) {
    out = out.replace(OLD_DAY3, NEW_DAY3);
  }
  for (const [re, rep] of PHRASE_FIXES) {
    out = out.replace(re, rep);
  }
  // подчистить двойные пробелы / « ,»
  out = out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/\(\s*\)/g, '')
    .replace(/,\s*я\s+уже/gi, ', я уже');
  return { changed: out !== before, out };
}

(async () => {
  const [rows] = await db.execute(
    `SELECT id, phone, prompt FROM accounts
     WHERE prompt LIKE '%глянем%'
        OR prompt LIKE '%вместе посмотрим%'
        OR prompt LIKE '%залетела на платформу%'`,
  );
  console.log('candidates', rows.length);
  let updated = 0;
  for (const row of rows) {
    const { changed, out } = patchPrompt(row.prompt);
    if (!changed) {
      console.log('skip', row.id, row.phone);
      continue;
    }
    await db.execute(`UPDATE accounts SET prompt = ? WHERE id = ?`, [out, row.id]);
    updated += 1;
    console.log('updated', row.id, row.phone, 'len', out.length);
  }
  console.log('UPDATED', updated);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
