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
    return { readerId, link, title: rec.title || rec.chatTitle, photos: photos.length };
  } catch (e) {
    return { readerId, link, error: e.message };
  }
}

async function main() {
  const targets = [
    [37, 'https://t.me/+bXtha9Jqc8A3NDc6'],
    [62, 'https://t.me/vikushakasa'],
    [53, 'https://t.me/+4bMFvqEBB_FlNzFi'],
  ];
  for (const [id, link] of targets) {
    const r = await countFor(id, link);
    console.log(JSON.stringify(r));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
