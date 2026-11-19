#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');
const fs = require('fs');

(async () => {
  const [[acc]] = await db.execute(
    `SELECT id, phone, user_id, status, is_autoreply_enabled,
            CHAR_LENGTH(IFNULL(prompt,'')) AS plen,
            CHAR_LENGTH(IFNULL(session_string,'')) AS slen,
            reply_delay_min, reply_delay_max, updated_at
     FROM accounts WHERE id = 53 OR phone LIKE '%995%930%71%'
     LIMIT 1`,
  );
  console.log('ACC', JSON.stringify(acc, null, 2));
  if (!acc) process.exit(1);

  const [[counts]] = await db.execute(
    `SELECT COUNT(*) AS total,
            SUM(role='user') AS user_n,
            SUM(role='assistant') AS bot_n,
            MAX(CASE WHEN role='user' THEN created_at END) AS last_user,
            MAX(CASE WHEN role='assistant' THEN created_at END) AS last_bot
     FROM conversation_messages WHERE account_id = ?`,
    [acc.id],
  );
  console.log('COUNTS', JSON.stringify(counts));

  const [recent] = await db.execute(
    `SELECT role, LEFT(content, 120) AS content, created_at, peer_id, peer_username
     FROM conversation_messages
     WHERE account_id = ?
     ORDER BY created_at DESC LIMIT 25`,
    [acc.id],
  );
  console.log('RECENT', JSON.stringify(recent, null, 2));

  try {
    const [paused] = await db.execute(
      `SELECT peer_id, created_at, updated_at FROM autoreply_disabled_peers
       WHERE account_id = ? ORDER BY updated_at DESC LIMIT 40`,
      [acc.id],
    );
    console.log('PAUSED_N', paused.length);
    console.log('PAUSED', JSON.stringify(paused, null, 2));
  } catch (e) {
    console.log('PAUSED_ERR', e.message);
  }

  try {
    const [help] = await db.execute(
      `SELECT * FROM help_requests WHERE account_id = ? ORDER BY id DESC LIMIT 10`,
      [acc.id],
    );
    console.log('HELP', JSON.stringify(help, null, 2));
  } catch (e) {
    console.log('HELP_ERR', e.message);
  }

  // unanswered: last msg is user
  const [unanswered] = await db.execute(
    `SELECT t.peer_id, t.last_role, t.last_at, t.last_content
     FROM (
       SELECT peer_id,
              SUBSTRING_INDEX(GROUP_CONCAT(role ORDER BY created_at DESC, id DESC), ',', 1) AS last_role,
              MAX(created_at) AS last_at,
              SUBSTRING_INDEX(GROUP_CONCAT(LEFT(content,80) ORDER BY created_at DESC, id DESC SEPARATOR '\\x1e'), '\\x1e', 1) AS last_content
       FROM conversation_messages
       WHERE account_id = ?
       GROUP BY peer_id
     ) t
     WHERE t.last_role = 'user'
     ORDER BY t.last_at DESC
     LIMIT 20`,
    [acc.id],
  );
  console.log('UNANSWERED', JSON.stringify(unanswered, null, 2));

  const out = fs.readFileSync('/root/.pm2/logs/tgbot-out.log').slice(-900000).toString('utf8');
  const err = fs.readFileSync('/root/.pm2/logs/tgbot-error.log').slice(-250000).toString('utf8');
  const filter = (l) =>
    /995\s*930|930\s*71-?73|Аккаунт 53|\bid\s*53\b|\[53\s|accountId[=:]?\s*53\b/i.test(l) ||
    (acc.phone && l.includes(String(acc.phone).replace(/\s+/g, ''))) ||
    l.includes('+7 995 930') ||
    l.includes('79959307173');

  console.log('--- OUT_HITS ---');
  out
    .split(/\n/)
    .filter(filter)
    .slice(-60)
    .forEach((l) => console.log(l.slice(0, 300)));

  console.log('--- ERR_HITS ---');
  err
    .split(/\n/)
    .filter(filter)
    .slice(-40)
    .forEach((l) => console.log(l.slice(0, 300)));

  console.log('--- STARTUP (last boot labels) ---');
  out
    .split(/\n/)
    .filter((l) => /подключ|сесси|session|AI включ|автоответ|аккаунт|label|995|старту/i.test(l))
    .slice(-50)
    .forEach((l) => console.log(l.slice(0, 260)));

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
