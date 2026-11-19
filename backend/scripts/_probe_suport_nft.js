#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

const db = require('../db');
const PEER = 'suport_service_v';

(async () => {
  const [cols] = await db.query(`SHOW COLUMNS FROM conversation_messages`);
  console.log(
    'COLS',
    cols.map((c) => c.Field).join(','),
  );

  const [msgs] = await db.query(
    `SELECT * FROM conversation_messages
     WHERE peer_id = ? OR peer_id LIKE ? OR username = ? OR peer_username = ?
     ORDER BY id ASC LIMIT 5`,
    [PEER, `%${PEER}%`, PEER, PEER],
  ).catch(async (e) => {
    console.error('try1', e.message);
    // discover peer_id column usage
    const [sample] = await db.query(`SELECT * FROM conversation_messages ORDER BY id DESC LIMIT 1`);
    console.log('SAMPLE_KEYS', sample[0] && Object.keys(sample[0]));
    return [[]];
  });
  console.log('FIRST_TRY', msgs.length);

  // find account for masha
  const [accs] = await db.query(
    `SELECT id, phone, display_name, name FROM accounts WHERE phone LIKE '%78688%' OR display_name LIKE '%Маш%' OR name LIKE '%Маш%' LIMIT 10`,
  ).catch(async () => {
    const [t] = await db.query(`SHOW TABLES LIKE '%account%'`);
    console.log('ACC_TABLES', t);
    return [[]];
  });
  console.log('ACCS', JSON.stringify(accs, null, 2));

  // peer_profiles
  const [pp] = await db.query(
    `SELECT * FROM peer_profiles WHERE peer_id LIKE ? OR username LIKE ? OR display_name LIKE ? LIMIT 20`,
    [`%${PEER}%`, `%${PEER}%`, '%Артур%'],
  ).catch((e) => {
    console.error('pp', e.message);
    return [[]];
  });
  console.log('PEER_PROFILES', JSON.stringify(pp, null, 2));

  // nft gates
  const [gates] = await db.query(
    `SELECT * FROM peer_nft_gates WHERE peer_id LIKE ? LIMIT 20`,
    [`%${PEER}%`],
  );
  console.log('NFT_GATES', JSON.stringify(gates, null, 2));

  // nft_voice_schedule
  const [sched] = await db.query(
    `SELECT * FROM nft_voice_schedule WHERE peer_id LIKE ? LIMIT 20`,
    [`%${PEER}%`],
  ).catch(() => [[]]);
  console.log('NFT_SCHED', JSON.stringify(sched, null, 2));

  // peer_self_told
  const [told] = await db.query(
    `SELECT * FROM peer_self_told WHERE peer_id LIKE ? LIMIT 20`,
    [`%${PEER}%`],
  ).catch(() => [[]]);
  console.log('SELF_TOLD', JSON.stringify(told, null, 2));

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
