#!/usr/bin/env node
/**
 * Load .env then prove peer_nft_gates survives memory wipe.
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

const hh = require('../services/humanHardening');

(async () => {
  const aid = 91099;
  const pid = `persist-0ge-${Date.now()}`;
  const a = hh.noteExplicitInterest(
    aid,
    pid,
    'расскажи подробнее как работает флип токены',
  );
  const b = hh.noteExplicitInterest(aid, pid, 'интересно покажи nft профит');
  console.log('NOTE_RESULTS', { a, b });
  await new Promise((r) => setTimeout(r, 1000));
  hh.__testClearPeerMemory(aid, pid);
  const s = await hh.hydratePeerGates(aid, pid);
  console.log('PERSIST_HITS', s.interestHits);
  if (s.interestHits < 2) {
    // direct DB peek
    try {
      const db = require('../db');
      const [rows] = await db.query(
        'SELECT * FROM peer_nft_gates WHERE account_id=? AND peer_id=? LIMIT 1',
        [aid, pid],
      );
      console.log('DB_ROW', rows && rows[0]);
    } catch (e) {
      console.error('DB_PEEK', e.message);
    }
    process.exit(2);
  }
  console.log('PERSIST_OK');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
