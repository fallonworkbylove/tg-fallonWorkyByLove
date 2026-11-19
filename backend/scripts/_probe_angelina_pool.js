require('dotenv').config();
const db = require('../db');
const { getMediaItems } = require('../services/mediaReplies');
const { getActiveClient } = require('../services/telegramClient');
const path = require('path');
const fs = require('fs');

(async () => {
  const [[a]] = await db.execute(
    'SELECT id, phone, media_chat_link FROM accounts WHERE id = 28 OR phone LIKE ? LIMIT 1',
    ['%9324437506%'],
  );
  console.log('account', a);
  if (!a) process.exit(0);
  const client = getActiveClient(a.id);
  console.log('clientOnline', Boolean(client));
  if (!client || !a.media_chat_link) {
    console.log('skip pool — no client or link');
    process.exit(0);
  }
  const r = await getMediaItems(client, a.id, a.media_chat_link);
  const types = {};
  const light = { day: 0, dark: 0, indoor: 0, unknown: 0 };
  // light cache file pattern
  const cacheRoot = path.join(__dirname, '..', 'data');
  let lightMap = {};
  try {
    const files = fs.readdirSync(cacheRoot).filter((f) => /light|own.?media/i.test(f));
    console.log('cache files', files);
  } catch (_) {}
  // try in-memory via mediaSend cachedOwnMediaLight if exported — else count types only
  for (const i of r.items || []) {
    types[i.type] = (types[i.type] || 0) + 1;
  }
  console.log('pool types', types, 'total', (r.items || []).length);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
