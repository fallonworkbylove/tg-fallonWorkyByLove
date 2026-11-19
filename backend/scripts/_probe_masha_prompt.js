require('dotenv').config();
const db = require('../db');
const pf = require('../services/personaFacts');

(async () => {
  const [rows] = await db.execute(
    `SELECT id, phone, LEFT(prompt, 40) AS p0, CHAR_LENGTH(prompt) AS plen, media_chat_link,
            is_autoreply_enabled
     FROM accounts
     WHERE LOWER(prompt) LIKE '%маш%'
        OR LOWER(prompt) LIKE '%зовут маш%'
        OR phone LIKE '%9959307173%'
        OR phone LIKE '%79959307173%'
     ORDER BY id
     LIMIT 20`,
  );
  console.log('candidates', rows);

  // also search name from prompt patterns
  const [all] = await db.execute(
    `SELECT id, phone, prompt, media_chat_link
     FROM accounts
     WHERE prompt IS NOT NULL AND prompt != ''
     ORDER BY id`,
  );
  const mashas = all.filter((r) => {
    const p = String(r.prompt || '');
    return (
      /зовут\s+маш/i.test(p) ||
      /ты\s+—\s*маш/i.test(p) ||
      /имя\s*[:\-–]?\s*маш/i.test(p) ||
      /^маш/i.test(p.slice(0, 80))
    );
  });
  console.log(
    'by name parse',
    mashas.map((r) => ({ id: r.id, phone: r.phone, plen: (r.prompt || '').length })),
  );

  for (const r of mashas.slice(0, 5)) {
    const card = pf.parsePersonaCard(r.prompt);
    console.log('\n=== account', r.id, r.phone, '===');
    console.log('card', card);
    console.log('prompt:\n', r.prompt);
    console.log('media', r.media_chat_link || '(none)');
  }

  // if phone from admin card Вика was 995... look for Машенька from screenshot earlier - user said Маша
  // From previous admin screenshot: Машенька +79959307173
  const [[m]] = await db.execute(
    `SELECT id, phone, prompt, media_chat_link FROM accounts WHERE phone LIKE '%9959307173%' OR phone LIKE '%79959307173%' LIMIT 1`,
  );
  if (m && !mashas.find((x) => x.id === m.id)) {
    console.log('\n=== by phone Машенька', m.id, '===');
    console.log('card', pf.parsePersonaCard(m.prompt));
    console.log(m.prompt);
  }

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
