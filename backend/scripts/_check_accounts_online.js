#!/usr/bin/env node
require('dotenv').config();
const path = require('path');

// Don't start full server — inspect DB flags + ask running process via HTTP if available
const Database = require('better-sqlite3');
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bot.db');
let db;
try {
  db = new Database(dbPath, { readonly: true });
} catch (e) {
  // try common paths
  const alts = [
    path.join(__dirname, '..', 'bot.db'),
    path.join(__dirname, '..', 'data.db'),
    '/root/opt/tgbot/tg-miniapp-loverussian/backend/data/bot.db',
  ];
  for (const p of alts) {
    try {
      db = new Database(p, { readonly: true });
      console.log('db', p);
      break;
    } catch (_) {}
  }
}
if (!db) {
  console.log('no db');
  process.exit(1);
}

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
console.log('tables', tables.filter((t) => /acc|user|sess/i.test(t)).join(', '));

let rows = [];
try {
  rows = db
    .prepare(
      `SELECT id, phone, username, worker_username, ai_enabled, is_active, status, session_string IS NOT NULL as has_session
       FROM accounts LIMIT 50`
    )
    .all();
} catch (e1) {
  try {
    rows = db.prepare(`SELECT * FROM accounts LIMIT 3`).all();
    console.log('sample keys', Object.keys(rows[0] || {}));
    rows = db.prepare(`SELECT * FROM accounts`).all();
  } catch (e2) {
    console.log('query fail', e1.message, e2.message);
    process.exit(1);
  }
}

for (const r of rows) {
  const phone = r.phone || r.number || '?';
  const worker = r.worker_username || r.username || r.owner || '?';
  console.log(
    JSON.stringify({
      id: r.id,
      phone,
      worker,
      ai: r.ai_enabled ?? r.ai_on ?? r.ai,
      active: r.is_active ?? r.active,
      status: r.status,
      has_session: r.has_session ?? Boolean(r.session_string || r.session),
    })
  );
}
