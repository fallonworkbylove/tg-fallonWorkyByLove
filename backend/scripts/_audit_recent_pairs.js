#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');

(async () => {
  const [rows] = await db.execute(`
    SELECT account_id, peer_id, role, LEFT(content, 180) AS content, created_at
    FROM conversation_messages
    WHERE created_at >= NOW() - INTERVAL 4 HOUR
      AND content NOT LIKE '[реакция:%'
      AND content NOT LIKE '[медиа:%'
      AND content NOT LIKE '[голосовое:%'
    ORDER BY id DESC
    LIMIT 50
  `);

  const weird = [];
  for (const r of rows) {
    const c = String(r.content || '').replace(/\s+/g, ' ').trim();
    const line = `${String(r.created_at).slice(0, 19)} a${r.account_id} ${r.role === 'assistant' ? 'BOT' : 'USR'} ${JSON.stringify(c)}`;
    console.log(line);
    if (r.role === 'assistant') {
      if (/чем сейчас занят\?/i.test(c) && /спокойной|доброй ночи|сладких/i.test(c)) {
        weird.push('goodnight+q: ' + c);
      }
      if (/а ты давно там жив/i.test(c)) weird.push('his-city mirror: ' + c);
      if (/можно так:|дорогой \[имя\]|поздравляем с вашим/i.test(c)) weird.push('assistant-mode: ' + c);
      if (/^(?:ага|поняла|хм ок)\)\s*$/i.test(c)) weird.push('stub: ' + c);
      if (/не была никогда/i.test(c) && /краснодар/i.test(c)) weird.push('geo-deny: ' + c);
    }
  }
  console.log('---WEIRD---');
  if (!weird.length) console.log('(none in sample)');
  else weird.forEach((w) => console.log(w));
  console.log('rows', rows.length);
  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
