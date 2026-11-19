/**
 * Apply full persona prompts for short broken accounts:
 * 24 Алёна Иваново, 27 Вика Тимашевск, 30 Алина Курск
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const db = require('../db');

const ROOT = path.resolve(__dirname, '../..');

const TARGETS = [
  {
    id: 24,
    phoneSuffix: '79808263068',
    name: 'Алёна',
    file: path.join(ROOT, 'prompts/alena_ivanovo.txt'),
    mustInclude: [/Ты — Алёна/, /Иваново/, /Викой/],
    mustNot: [/будь Аней/i, /ты алена \(девушка/i, /ты вика/i],
  },
  {
    id: 27,
    phoneSuffix: '79959307173',
    name: 'Вика',
    file: path.join(ROOT, 'prompts/vika_timashevsk.txt'),
    mustInclude: [/Ты — Вика/, /Тимашевск/, /Аней/],
    mustNot: [/будь Аней/i, /ты вика \(девушка/i, /Просто будь Аней/i],
  },
  {
    id: 30,
    phoneSuffix: '79149759457',
    name: 'Алина',
    file: path.join(ROOT, 'prompts/alina_kursk.txt'),
    mustInclude: [/Ты — Алина/, /Курск/, /Аней/],
    mustNot: [/будь Аней/i, /ты алина \(девушка/i, /Просто будь Аней/i],
  },
];

(async () => {
  for (const t of TARGETS) {
    const prompt = fs.readFileSync(t.file, 'utf8').replace(/\r\n/g, '\n').trim() + '\n';
    for (const re of t.mustInclude) {
      if (!re.test(prompt)) throw new Error(`${t.name}: missing ${re}`);
    }
    for (const re of t.mustNot) {
      if (re.test(prompt)) throw new Error(`${t.name}: forbidden ${re}`);
    }

    const [rows] = await db.execute(
      `SELECT id, phone, CHAR_LENGTH(IFNULL(prompt,'')) AS plen, is_autoreply_enabled
       FROM accounts WHERE id = ? LIMIT 1`,
      [t.id],
    );
    if (!rows.length) throw new Error(`account id=${t.id} not found`);
    const acc = rows[0];
    if (!String(acc.phone || '').includes(t.phoneSuffix.replace(/^\+/, ''))) {
      throw new Error(
        `id=${t.id} phone mismatch: got ${acc.phone}, expected *${t.phoneSuffix}`,
      );
    }

    await db.execute(`UPDATE accounts SET prompt = ? WHERE id = ? LIMIT 1`, [prompt, t.id]);

    const [[after]] = await db.execute(
      `SELECT id, phone, CHAR_LENGTH(prompt) AS plen, LEFT(prompt, 60) AS head
       FROM accounts WHERE id = ?`,
      [t.id],
    );
    console.log(
      JSON.stringify({
        ok: true,
        id: after.id,
        phone: after.phone,
        name: t.name,
        before: acc.plen,
        after: after.plen,
        ai: acc.is_autoreply_enabled ? 1 : 0,
        head: after.head,
      }),
    );
  }
  console.log('APPLY_FULL_PROMPTS_0HG_OK');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
