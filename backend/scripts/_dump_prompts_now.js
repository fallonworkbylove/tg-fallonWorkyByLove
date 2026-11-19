require('dotenv').config();
const db = require('../db');

function oneLine(s, n = 240) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);
}

function nameGuess(prompt) {
  const p = String(prompt || '');
  const m =
    p.match(/Ты\s*[—\-–]\s*([А-ЯЁA-Za-z][а-яёa-zA-Z\-]+)/) ||
    p.match(/зовут\s+([А-ЯЁA-Za-z][а-яёa-zA-Z\-]+)/i) ||
    p.match(/имя[:\s]+([А-ЯЁA-Za-z][а-яёa-zA-Z\-]+)/i);
  return m ? m[1] : '?';
}

function cityGuess(prompt) {
  const p = String(prompt || '');
  const m =
    p.match(/жив[её]шь\s+в\s+([А-ЯЁ][а-яёA-Za-z\- ]{2,40}?)(?:[.,!\n]|$)/i) ||
    p.match(/из\s+([А-ЯЁ][а-яёA-Za-z\- ]{2,40}?)(?:[.,!\n]|$)/i) ||
    p.match(/город[еу]?\s+([А-ЯЁ][а-яёA-Za-z\- ]{2,40}?)(?:[.,!\n]|$)/i);
  return m ? m[1].trim() : '?';
}

(async () => {
  const [rows] = await db.execute(
    `SELECT id, phone, is_autoreply_enabled, prompt,
            CHAR_LENGTH(IFNULL(prompt,'')) AS plen
     FROM accounts
     ORDER BY id`,
  );

  console.log('=== ALL ACCOUNTS ===');
  for (const r of rows) {
    console.log(
      [
        `id=${r.id}`,
        `phone=${r.phone}`,
        `AI=${r.is_autoreply_enabled ? 1 : 0}`,
        `len=${r.plen}`,
        `name=${nameGuess(r.prompt)}`,
        `city≈${cityGuess(r.prompt)}`,
        `head=${oneLine(r.prompt, 180)}`,
      ].join(' | '),
    );
  }

  console.log('\n=== FULL PROMPTS (sorted by name) ===');
  const withPrompt = rows.filter((r) => r.plen > 0);
  withPrompt.sort((a, b) => nameGuess(a.prompt).localeCompare(nameGuess(b.prompt), 'ru'));
  for (const r of withPrompt) {
    console.log(`\n######## id=${r.id} phone=${r.phone} name=${nameGuess(r.prompt)} len=${r.plen} ########`);
    console.log(String(r.prompt || ''));
    console.log('######## END ########');
  }

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
