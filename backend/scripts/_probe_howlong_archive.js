#!/usr/bin/env node
/**
 * Find how-long asks + next user reply; count ≥14d archives candidates.
 */
require('dotenv').config();
const db = require('../db');

(async () => {
  const [asks] = await db.execute(
    `SELECT id, account_id, peer_id, peer_username, content, created_at
     FROM conversation_messages
     WHERE role = 'assistant'
       AND (content LIKE '%на дв?%' OR content LIKE '%давно тут сидишь%')
       AND created_at > NOW() - INTERVAL 14 DAY
     ORDER BY created_at DESC
     LIMIT 200`,
  );
  console.log('asks_14d', asks.length);

  let parsed = 0;
  let ge14 = 0;
  let lt14 = 0;
  let unparsed = 0;
  let noReply = 0;
  const ge14Samples = [];
  const recentAsks = asks.filter((a) => a.created_at >= new Date(Date.now() - 3 * 864e5));

  for (const a of asks) {
    const [replies] = await db.execute(
      `SELECT content, created_at FROM conversation_messages
       WHERE account_id = ? AND peer_id = ? AND role = 'user'
         AND created_at > ?
       ORDER BY created_at ASC LIMIT 1`,
      [a.account_id, a.peer_id, a.created_at],
    );
    if (!replies.length) {
      noReply += 1;
      continue;
    }
    const text = replies[0].content;
    // inline parseStayDays-lite: bare number / weeks / months
    const t = String(text || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/^\[[^\]]*\]:\s*/g, '')
      .trim();
    let days = null;
    const bare = t.match(/^(?:ну\s+|где[- ]то\s+|около\s+|примерно\s+|дня\s+)?(\d{1,3})[\s)!.]*$/);
    if (bare) days = Number(bare[1]);
    else {
      const m = t.match(/(\d+(?:[.,]\d+)?)\s*(дн|день|сут|недел|мес|год|лет)/);
      if (m) {
        const n = parseFloat(m[1].replace(',', '.'));
        const u = m[2];
        days = /недел/.test(u) ? n * 7 : /мес/.test(u) ? n * 30 : /год|лет/.test(u) ? n * 365 : n;
      } else if (/месяц/.test(t)) days = 30;
      else if (/недел/.test(t)) days = 14;
      else if (/давно|долго|вечность/.test(t) && t.length < 40) days = 60;
      else if (/недавно|вчера|сегодня|первый\s+день/.test(t)) days = 1;
    }
    if (days == null) {
      unparsed += 1;
      continue;
    }
    parsed += 1;
    if (days >= 14) {
      ge14 += 1;
      if (ge14Samples.length < 12) {
        ge14Samples.push({
          account_id: a.account_id,
          peer: a.peer_username || a.peer_id,
          ask_at: a.created_at,
          reply: String(text).slice(0, 80),
          days,
          reply_at: replies[0].created_at,
        });
      }
    } else lt14 += 1;
  }

  console.log({ parsed, ge14, lt14, unparsed, noReply });
  console.log('ge14_samples', ge14Samples);

  // Are those peers currently archived?
  for (const s of ge14Samples.slice(0, 8)) {
    const [arch] = await db.execute(
      `SELECT archived_at, reason FROM archived_peers
       WHERE account_id = ? AND peer_id = ?
       ORDER BY archived_at DESC LIMIT 1`,
      [s.account_id, String(s.peer).match(/^\d+$/) ? s.peer : null],
    ).catch(() => [[]]);
    // peer_id lookup — fix with id from asks
  }

  // Better: check archived for samples with peer_id from asks
  const samplesWithArch = [];
  for (const a of asks) {
    if (samplesWithArch.length >= 10) break;
    const [replies] = await db.execute(
      `SELECT content, created_at FROM conversation_messages
       WHERE account_id = ? AND peer_id = ? AND role = 'user' AND created_at > ?
       ORDER BY created_at ASC LIMIT 1`,
      [a.account_id, a.peer_id, a.created_at],
    );
    if (!replies.length) continue;
    const t = String(replies[0].content || '').toLowerCase();
    const bare = t.match(/^(?:ну\s+|где[- ]то\s+|около\s+|примерно\s+|дня\s+)?(\d{1,3})[\s)!.]*$/);
    let days = bare ? Number(bare[1]) : null;
    if (days == null) {
      const m = t.match(/(\d+(?:[.,]\d+)?)\s*(дн|день|сут|недел|мес|год|лет)/);
      if (m) {
        const n = parseFloat(m[1].replace(',', '.'));
        days = /недел/.test(m[2]) ? n * 7 : /мес/.test(m[2]) ? n * 30 : /год|лет/.test(m[2]) ? n * 365 : n;
      }
    }
    if (days == null || days < 14) continue;
    const [arch] = await db.execute(
      `SELECT archived_at FROM archived_peers
       WHERE account_id = ? AND peer_id = ?
       ORDER BY archived_at DESC LIMIT 1`,
      [a.account_id, a.peer_id],
    ).catch(async () => {
      // table schema may differ
      try {
        const [r] = await db.execute(`SHOW COLUMNS FROM archived_peers`);
        return [[{ _cols: r.map((x) => x.Field) }]];
      } catch (e) {
        return [[{ err: e.message }]];
      }
    });
    samplesWithArch.push({
      account_id: a.account_id,
      peer_id: a.peer_id,
      peer: a.peer_username,
      days,
      reply: String(replies[0].content).slice(0, 60),
      ask_at: a.created_at,
      archived: arch[0] || null,
    });
  }
  console.log('ge14_vs_archive', samplesWithArch);

  // asks last 48h
  const [a48] = await db.execute(
    `SELECT COUNT(*) n FROM conversation_messages
     WHERE role='assistant' AND content LIKE '%на дв?%'
       AND created_at > NOW() - INTERVAL 48 HOUR`,
  );
  const [a24] = await db.execute(
    `SELECT COUNT(*) n FROM conversation_messages
     WHERE role='assistant' AND content LIKE '%на дв?%'
       AND created_at > NOW() - INTERVAL 24 HOUR`,
  );
  console.log('asks_48h', a48[0], 'asks_24h', a24[0]);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
