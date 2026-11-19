#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');

(async () => {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }

  const [cols] = await db.execute(`SHOW COLUMNS FROM accounts`);
  const names = cols.map((c) => c.Field);
  console.log('cols', names.filter((n) => /session|phone|active|online|auto/i.test(n)).join(','));

  const sessionCol = names.includes('session_string')
    ? 'session_string'
    : names.includes('session')
      ? 'session'
      : null;
  if (!sessionCol) {
    console.log('no session col');
    process.exit(1);
  }

  const [rows] = await db.execute(
    `SELECT id, phone, ${sessionCol} AS sess, is_autoreply_enabled
     FROM accounts ORDER BY id`,
  );
  const byHash = new Map();
  for (const r of rows) {
    const s = String(r.sess || '');
    const h = s ? crypto.createHash('sha1').update(s).digest('hex').slice(0, 12) : 'EMPTY';
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push({ id: r.id, phone: r.phone, len: s.length, ai: r.is_autoreply_enabled });
    console.log(r.id, r.phone, 'h=' + h, 'len=' + s.length, 'ai=' + r.is_autoreply_enabled);
  }
  console.log('===DUPLICATE_SESSIONS===');
  let dups = 0;
  for (const [h, list] of byHash) {
    if (h === 'EMPTY') continue;
    if (list.length > 1) {
      dups += 1;
      console.log(h, list.map((x) => x.id + ':' + x.phone).join(' | '));
    }
  }
  if (!dups) console.log('none');

  const byPhone = new Map();
  for (const r of rows) {
    const p = String(r.phone || '');
    if (!byPhone.has(p)) byPhone.set(p, []);
    byPhone.get(p).push(r.id);
  }
  console.log('===DUPLICATE_PHONES===');
  for (const [p, ids] of byPhone) {
    if (ids.length > 1) console.log(p, ids.join(','));
  }

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
