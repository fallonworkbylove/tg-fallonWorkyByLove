// Пробник: скачивает фото из медиа-канала Telegram-аккаунта (без записи в ledger).
// Использование: node scripts/_probe_tg_photos.js <telegram_account_id> [media_chat_link]
require('dotenv').config();
const db = require('../db');
const tc = require('../services/telegramClient');
const mediaReplies = require('../services/mediaReplies');

(async () => {
  const id = Number(process.argv[2]);
  if (!id) throw new Error('укажи telegram_account_id');
  const [[row]] = await db.execute(
    'SELECT id, media_chat_link, session_string FROM accounts WHERE id = ? LIMIT 1',
    [id],
  );
  if (!row) throw new Error(`аккаунт #${id} не найден`);
  const link = process.argv[3] || row.media_chat_link;
  if (!link) throw new Error('нет media_chat_link');

  let client = tc.getActiveClient(id);
  if (!client) {
    const ok = await tc.activateAccount(id, row.session_string).catch((e) => {
      console.error('activate err', e.message);
      return false;
    });
    console.log('activate:', ok);
    client = tc.getActiveClient(id);
  }
  if (!client) throw new Error('клиент не поднялся');

  const rec = await mediaReplies.getMediaItems(client, id, link);
  const photos = (rec.items || []).filter((i) => i.type === 'photo');
  const videos = (rec.items || []).filter((i) => i.type === 'video');
  const circles = (rec.items || []).filter((i) => i.type === 'circle');
  console.log(`link=${link}`);
  console.log(`items=${(rec.items || []).length} photos=${photos.length} videos=${videos.length} circles=${circles.length}`);

  let n = 0;
  for (const item of photos) {
    if (n >= 3) break;
    const buf = await client.downloadMedia(item.msg, {}).catch(() => null);
    console.log(`  photo #${item.id}: ${buf ? `${buf.length} bytes` : 'download failed'}`);
    n += 1;
  }
  await db.end().catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.error('fatal:', e.message);
  process.exit(1);
});
