require('dotenv').config();
const db = require('../db');
const tc = require('../services/telegramClient');
const mediaReplies = require('../services/mediaReplies');

async function countFor(readerId, link) {
  const [[acc]] = await db.execute(
    'SELECT session_string FROM accounts WHERE id = ? LIMIT 1',
    [readerId],
  );
  if (!acc || !acc.session_string) return { readerId, link, error: 'no session' };
  let client = tc.getActiveClient(readerId);
  if (!client) {
    const ok = await tc.activateAccount(readerId, acc.session_string).catch(() => false);
    if (ok === true) client = tc.getActiveClient(readerId);
  }
  if (!client) return { readerId, link, error: 'client not available' };
  try {
    const rec = await mediaReplies.getMediaItems(client, readerId, link);
    const photos = (rec.items || []).filter((it) => it.type === 'photo');
    return { readerId, link, photos: photos.length };
  } catch (e) {
    return { readerId, link, error: e.message };
  }
}

async function main() {
  const [rows] = await db.execute(
    `SELECT id, user_id, media_chat_link
     FROM accounts
     WHERE media_chat_link IS NOT NULL AND media_chat_link != ''
       AND session_string IS NOT NULL AND session_string != ''
     ORDER BY id`,
  );
  for (const r of rows) {
    const res = await countFor(r.id, r.media_chat_link);
    console.log(JSON.stringify({ ...res, user_id: r.user_id }));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
