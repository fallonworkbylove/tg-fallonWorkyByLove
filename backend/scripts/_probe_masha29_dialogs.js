#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');

(async () => {
  const [[acc]] = await db.execute(
    `SELECT id, phone, status, is_autoreply_enabled FROM accounts WHERE id = 29 OR phone LIKE '%79601878688%' LIMIT 1`,
  );
  console.log('account', acc);
  if (!acc) process.exit(1);

  // peersTotal in ops = distinct peers in conversation_messages (not telegram archive)
  const [peers] = await db.execute(
    `SELECT peer_id,
            MAX(peer_username) AS uname,
            COUNT(*) AS msgs,
            SUM(role='user') AS user_n,
            SUM(role='assistant') AS bot_n,
            MAX(created_at) AS last_any,
            MAX(CASE WHEN role='user' THEN created_at END) AS last_user
     FROM conversation_messages
     WHERE account_id = ?
     GROUP BY peer_id
     ORDER BY last_any DESC`,
    [acc.id],
  );
  console.log('dialogs_total_db', peers.length);

  const [arch] = await db.execute(
    `SELECT peer_id, archived_at FROM archived_peers WHERE account_id = ?`,
    [acc.id],
  ).catch(() => [[]]);
  const archSet = new Set(arch.map((r) => String(r.peer_id)));

  const [pause] = await db.execute(
    `SELECT peer_id, reason, created_at FROM autoreply_disabled_peers WHERE account_id = ?`,
    [acc.id],
  ).catch(() => [[]]);
  const pauseMap = new Map(pause.map((r) => [String(r.peer_id), r]));

  const notArch = peers.filter((p) => !archSet.has(String(p.peer_id)));
  const inArch = peers.filter((p) => archSet.has(String(p.peer_id)));

  console.log('archived_in_db', arch.length, 'of_dialogs_with_history_archived', inArch.length);
  console.log('not_archived_count', notArch.length);

  function agoH(dt) {
    if (!dt) return null;
    return Math.floor((Date.now() - new Date(dt).getTime()) / 3600000);
  }

  console.log(
    'NOT_ARCHIVED_LIST',
    notArch.map((p) => ({
      peer_id: p.peer_id,
      uname: p.uname ? `@${p.uname}` : null,
      msgs: p.msgs,
      last_user_h: agoH(p.last_user),
      last_any_h: agoH(p.last_any),
      paused: pauseMap.get(String(p.peer_id))?.reason || null,
    })),
  );
  console.log(
    'ARCHIVED_LIST',
    inArch.map((p) => ({
      peer_id: p.peer_id,
      uname: p.uname ? `@${p.uname}` : null,
    })),
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
