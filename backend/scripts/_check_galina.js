#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');
const fs = require('fs');
const telegramClient = require('../services/telegramClient');

(async () => {
  const [[acc]] = await db.execute(
    `SELECT id, phone, user_id, status, is_autoreply_enabled,
            CHAR_LENGTH(IFNULL(prompt,'')) AS plen,
            CHAR_LENGTH(IFNULL(session_string,'')) AS slen,
            reply_delay_min, reply_delay_max, updated_at
     FROM accounts WHERE phone LIKE '%9601878670%' LIMIT 1`,
  );
  console.log('ACCOUNT', JSON.stringify(acc, null, 2));
  if (!acc) process.exit(1);

  let active = null;
  try {
    active = typeof telegramClient.isActive === 'function' ? telegramClient.isActive(acc.id) : null;
  } catch (e) {
    active = `err:${e.message}`;
  }
  console.log('IS_ACTIVE', active);

  const [recent] = await db.execute(
    `SELECT role, LEFT(content, 140) AS content, created_at, peer_id, peer_username
     FROM conversation_messages
     WHERE account_id = ?
     ORDER BY created_at DESC
     LIMIT 20`,
    [acc.id],
  );
  console.log('RECENT_MSGS', JSON.stringify(recent, null, 2));

  const [[counts]] = await db.execute(
    `SELECT COUNT(*) AS total,
            SUM(role='user') AS user_n,
            SUM(role='assistant') AS bot_n,
            MAX(created_at) AS last_at
     FROM conversation_messages WHERE account_id = ?`,
    [acc.id],
  );
  console.log('COUNTS', counts);

  const out = fs.readFileSync('/root/.pm2/logs/tgbot-out.log');
  const err = fs.readFileSync('/root/.pm2/logs/tgbot-error.log');
  const outTail = out.slice(-400000).toString('utf8');
  const errTail = err.slice(-80000).toString('utf8');
  const re = /9601878670|79601878670|Галин|accountId[=:]?\s*68|\bid\s*68\b|\[68\s|—\s*Галин/i;
  const outHits = outTail.split(/\n/).filter((l) => re.test(l)).slice(-30);
  const errHits = errTail.split(/\n/).filter((l) => re.test(l)).slice(-20);
  console.log('OUT_HITS', outHits.length);
  outHits.forEach((l) => console.log(l.slice(0, 240)));
  console.log('ERR_HITS', errHits.length);
  errHits.forEach((l) => console.log(l.slice(0, 240)));

  // Label in logs often uses phone or first name from TG
  const phoneHits = outTail.split(/\n/).filter((l) => l.includes('9601878670') || l.includes('79601878670')).slice(-20);
  console.log('PHONE_LOG', phoneHits.length);
  phoneHits.forEach((l) => console.log(l.slice(0, 240)));

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
