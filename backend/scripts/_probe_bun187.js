#!/usr/bin/env node
/**
 * Find account dialog with @bun187 and last activity age.
 */
require('dotenv').config();
const db = require('../db');

function agoHours(dt) {
  if (!dt) return null;
  const t = new Date(dt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 3600000);
}

(async () => {
  const [msgCols] = await db.execute('SHOW COLUMNS FROM conversation_messages');
  console.log('messages_cols', msgCols.map((c) => c.Field).join(','));

  const [accCols] = await db.execute('SHOW COLUMNS FROM accounts');
  console.log('accounts_cols', accCols.map((c) => c.Field).join(','));

  const like = '%bun187%';
  const [byUser] = await db.execute(
    `SELECT account_id, peer_id,
            MAX(peer_username) AS uname,
            COUNT(*) AS msgs,
            SUM(role = 'user') AS user_n,
            SUM(role = 'assistant') AS bot_n,
            MAX(created_at) AS last_any,
            MAX(CASE WHEN role = 'user' THEN created_at END) AS last_user,
            MAX(CASE WHEN role = 'assistant' THEN created_at END) AS last_bot
     FROM conversation_messages
     WHERE LOWER(COALESCE(peer_username,'')) LIKE ?
     GROUP BY account_id, peer_id`,
    [like],
  );
  console.log('by_peer_username', JSON.stringify(byUser, null, 2));

  // content / sender name fallback
  const [byContent] = await db.execute(
    `SELECT account_id, peer_id, peer_username, role, LEFT(content, 120) AS snip, created_at
     FROM conversation_messages
     WHERE LOWER(content) LIKE ? OR LOWER(COALESCE(peer_username,'')) LIKE ?
     ORDER BY created_at DESC
     LIMIT 30`,
    [like, like],
  );
  console.log('content_hits', byContent.length);

  const rows = byUser.length ? byUser : [];
  if (!rows.length && byContent.length) {
    const seen = new Set();
    for (const r of byContent) {
      const k = `${r.account_id}:${r.peer_id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({
        account_id: r.account_id,
        peer_id: r.peer_id,
        uname: r.peer_username,
      });
    }
  }

  for (const r of rows) {
    const [accRows] = await db.execute(`SELECT * FROM accounts WHERE id = ? LIMIT 1`, [r.account_id]);
    const acc = accRows[0] || { id: r.account_id };

    const [flags] = await db.execute(
      `SELECT focus, note, funnel_stage, updated_at
       FROM operator_lead_flags
       WHERE account_id = ? AND peer_id = ?
       LIMIT 1`,
      [r.account_id, String(r.peer_id)],
    ).catch(() => [[]]);

    const [pause] = await db.execute(
      `SELECT *
       FROM autoreply_disabled_peers
       WHERE account_id = ? AND peer_id = ?
       ORDER BY id DESC LIMIT 1`,
      [r.account_id, String(r.peer_id)],
    ).catch(() => [[]]);

    const [lastMsgs] = await db.execute(
      `SELECT role, LEFT(content, 160) AS snip, created_at, peer_username
       FROM conversation_messages
       WHERE account_id = ? AND peer_id = ?
       ORDER BY created_at DESC
       LIMIT 8`,
      [r.account_id, String(r.peer_id)],
    );

    console.log('==== MATCH ====');
    console.log({
      account: acc || { id: r.account_id },
      peer_id: r.peer_id,
      username: r.uname,
      msgs: r.msgs,
      user_n: r.user_n,
      bot_n: r.bot_n,
      last_any: r.last_any,
      last_user: r.last_user,
      last_bot: r.last_bot,
      ago_user_h: agoHours(r.last_user),
      ago_any_h: agoHours(r.last_any),
      flags: flags[0] || null,
      pause: pause[0] || null,
    });
    console.log('last_msgs', lastMsgs);
  }

  if (!rows.length) console.log('NO_MATCH for bun187');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
