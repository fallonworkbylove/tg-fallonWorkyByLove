#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');

(async () => {
  const [[ai]] = await db.query(
    'SELECT COUNT(*) c FROM accounts WHERE is_autoreply_enabled=1',
  );
  const cols = await db.query('SHOW COLUMNS FROM accounts');
  const colNames = cols[0].map((r) => r.Field);
  let noSession = null;
  if (colNames.includes('session_string')) {
    const [[r]] = await db.query(
      "SELECT COUNT(*) c FROM accounts WHERE is_autoreply_enabled=1 AND (session_string IS NULL OR session_string='')",
    );
    noSession = r.c;
  } else if (colNames.includes('tg_session')) {
    const [[r]] = await db.query(
      "SELECT COUNT(*) c FROM accounts WHERE is_autoreply_enabled=1 AND (tg_session IS NULL OR tg_session='')",
    );
    noSession = r.c;
  }

  const labelCol = colNames.includes('display_name')
    ? 'display_name'
    : colNames.includes('first_name')
      ? 'first_name'
      : colNames.includes('username')
        ? 'username'
        : colNames.includes('phone')
          ? 'phone'
          : 'id';
  const [prompts] = await db.query(`
    SELECT id, ${labelCol} AS name, CHAR_LENGTH(COALESCE(prompt,'')) plen
    FROM accounts WHERE is_autoreply_enabled=1
    ORDER BY plen ASC LIMIT 20`);

  const stubRe =
    "^(ок|поняла|ясно|ага|угу|мм+|ну ок)[)\\]!?.]*$";
  const [[stub24]] = await db.query(
    `SELECT COUNT(*) c FROM conversation_messages
     WHERE role='assistant' AND created_at>NOW()-INTERVAL 24 HOUR
       AND TRIM(content) REGEXP ?`,
    [stubRe],
  );
  const [[stub6]] = await db.query(
    `SELECT COUNT(*) c FROM conversation_messages
     WHERE role='assistant' AND created_at>NOW()-INTERVAL 6 HOUR
       AND TRIM(content) REGEXP ?`,
    [stubRe],
  );
  const [[stubPost]] = await db.query(
    `SELECT COUNT(*) c FROM conversation_messages
     WHERE role='assistant' AND created_at>'2026-11-01 16:00:00'
       AND TRIM(content) REGEXP ?`,
    [stubRe],
  );

  const gapSql = (hours) => `
    SELECT COUNT(*) c FROM (
      SELECT cm.account_id, cm.peer_id
      FROM conversation_messages cm
      JOIN accounts a ON a.id=cm.account_id AND a.is_autoreply_enabled=1
      LEFT JOIN conversation_messages ca
        ON ca.account_id=cm.account_id AND ca.peer_id=cm.peer_id
       AND ca.role='assistant' AND ca.created_at>cm.created_at
      LEFT JOIN autoreply_disabled_peers ad
        ON ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id
      WHERE cm.role='user'
        AND cm.created_at>NOW()-INTERVAL ${Number(hours)} HOUR
        AND ca.id IS NULL
        AND ad.id IS NULL
      GROUP BY cm.account_id, cm.peer_id
    ) t`;

  const [[gaps2h]] = await db.query(gapSql(2));
  const [[gaps12h]] = await db.query(gapSql(12));

  const [gapSamples] = await db.query(`
    SELECT cm.account_id, a.${labelCol} AS name, cm.peer_id,
           LEFT(cm.content,100) txt, cm.created_at
    FROM conversation_messages cm
    JOIN accounts a ON a.id=cm.account_id AND a.is_autoreply_enabled=1
    LEFT JOIN conversation_messages ca
      ON ca.account_id=cm.account_id AND ca.peer_id=cm.peer_id
     AND ca.role='assistant' AND ca.created_at>cm.created_at
    LEFT JOIN autoreply_disabled_peers ad
      ON ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id
    WHERE cm.role='user' AND cm.created_at>NOW()-INTERVAL 6 HOUR
      AND ca.id IS NULL AND ad.id IS NULL
    ORDER BY cm.created_at DESC LIMIT 18`);

  const [stubSamples] = await db.query(
    `SELECT account_id, peer_id, LEFT(content,50) txt, created_at
     FROM conversation_messages
     WHERE role='assistant' AND created_at>NOW()-INTERVAL 12 HOUR
       AND TRIM(content) REGEXP ?
     ORDER BY created_at DESC LIMIT 12`,
    [stubRe],
  );

  const peerCols = (await db.query('SHOW COLUMNS FROM autoreply_disabled_peers'))[0].map(
    (r) => r.Field,
  );
  let filt = { c: null };
  if (peerCols.includes('operator_note')) {
    [[filt]] = await db.query(`
      SELECT COUNT(*) c FROM autoreply_disabled_peers
      WHERE created_at>NOW()-INTERVAL 24 HOUR
        AND COALESCE(operator_note,'') LIKE 'отсев:%'`);
  } else if (peerCols.includes('reason')) {
    [[filt]] = await db.query(`
      SELECT COUNT(*) c FROM autoreply_disabled_peers
      WHERE created_at>NOW()-INTERVAL 24 HOUR
        AND COALESCE(reason,'') LIKE 'отсев:%'`);
  }

  let healLog = { c: null };
  try {
    [[healLog]] = await db.query(`
      SELECT COUNT(*) c FROM conversation_messages
      WHERE role='assistant' AND created_at>NOW()-INTERVAL 3 HOUR
        AND content LIKE '%[silenceCatchup]%'`);
  } catch (_) {
    healLog = { c: -1 };
  }

  console.log(
    JSON.stringify(
      {
        ai_on: ai.c,
        no_session: noSession,
        account_cols_sample: colNames.filter((c) =>
          /session|string|auth|phone/i.test(c),
        ),
        stubs_24h: stub24.c,
        stubs_6h: stub6.c,
        stubs_since_0hf_approx: stubPost.c,
        gaps_2h_active: gaps2h.c,
        gaps_12h_active: gaps12h.c,
        howlong_otsev_24h: filt.c,
        peer_cols: peerCols,
        silence_tag_msgs_3h: healLog.c,
        shortest_prompts: prompts.slice(0, 10),
        gap_samples: gapSamples,
        stub_samples: stubSamples,
      },
      null,
      2,
    ),
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
