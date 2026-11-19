/**
 * Назначает тгк-каналы bulk-аккаунтам из accounts.txt (round-robin) и пишет
 * tagged/photos/sources.json — оттуда их берут main.py и экспортёр фото.
 *
 * Запуск (из backend/): node scripts/_assign_photos.js
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const TAGGED_DIR = path.join(__dirname, '..', '..', 'tagged');
const SOURCES_PATH = path.join(TAGGED_DIR, 'photos', 'sources.json');
const ACCOUNTS_TXT = path.join(TAGGED_DIR, 'accounts.txt');

function safeKey(email) {
  return (
    String(email || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown'
  );
}

// Каналы-источники (reader — Telegram-аккаунт с живой сессией).
const CHANNELS = [
  { link: 'https://t.me/+bXtha9Jqc8A3NDc6', reader: 37 },
  { link: 'https://t.me/+4bMFvqEBB_FlNzFi', reader: 53 },
  { link: 'https://t.me/+GAfYTclNa4JmZDMy', reader: 57 },
  { link: 'https://t.me/c/2936362700/95', reader: 60 },
  { link: 'https://t.me/c/3983818988/2', reader: 63 },
];

function main() {
  const emails = fs
    .readFileSync(ACCOUNTS_TXT, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.split(':')[0].trim())
    .filter((e) => e && !e.startsWith('#'));

  let sources = {};
  try {
    sources = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
  } catch (_) {
    sources = {};
  }

  emails.forEach((email, i) => {
    const ch = CHANNELS[i % CHANNELS.length];
    sources[safeKey(email)] = {
      media_chat_link: ch.link,
      photo_reader_account_id: ch.reader,
    };
  });

  fs.mkdirSync(path.dirname(SOURCES_PATH), { recursive: true });
  fs.writeFileSync(SOURCES_PATH, JSON.stringify(sources, null, 2), 'utf8');
  console.log(`sources.json: ${Object.keys(sources).length} записей, каналов ${CHANNELS.length}`);
}

main();
