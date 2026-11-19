#!/usr/bin/env node
/**
 * Теория «1 раз в 2 дня»: смотрим интервалы между реальными отправками
 * одному peer и сколько раз один peer получал скрин за последние N дней.
 */
require('dotenv').config();
const db = require('../db');

(async () => {
  // Все реальные отправки (есть файл) за 14 дней
  const [sends] = await db.execute(`
    SELECT account_id, peer_id, peer_username, send_date, sent_at, image_file
    FROM daily_photo_sends
    WHERE image_file IS NOT NULL AND image_file <> '' AND image_file <> '__claiming__'
      AND send_date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
    ORDER BY account_id, peer_id, sent_at
  `);

  const byPeer = new Map();
  for (const r of sends) {
    const k = `${r.account_id}:${r.peer_id}`;
    if (!byPeer.has(k)) byPeer.set(k, []);
    byPeer.get(k).push(r);
  }

  const intervalsDays = [];
  const multi = [];
  let once = 0;
  let twicePlus = 0;

  for (const [k, rows] of byPeer) {
    if (rows.length === 1) once += 1;
    else {
      twicePlus += 1;
      multi.push({
        key: k,
        username: rows[0].peer_username,
        n: rows.length,
        dates: rows.map((r) => String(r.send_date).slice(0, 10)),
      });
    }
    for (let i = 1; i < rows.length; i += 1) {
      const a = new Date(rows[i - 1].sent_at).getTime();
      const b = new Date(rows[i].sent_at).getTime();
      const days = (b - a) / (24 * 3600 * 1000);
      intervalsDays.push({
        key: k,
        username: rows[0].peer_username,
        days: Math.round(days * 10) / 10,
        from: rows[i - 1].send_date,
        to: rows[i].send_date,
      });
    }
  }

  // Распределение: сколько peer'ов получили 1/2/3/4 скрина
  const hist = {};
  for (const rows of byPeer.values()) {
    const n = rows.length;
    hist[n] = (hist[n] || 0) + 1;
  }

  console.log('=== CODE WINDOW REMINDER ===');
  console.log('schedule: 1 slot / peer / calendar day (UNIQUE send_date)');
  console.log('skip if dialog age < 20h (too_early) OR age >= NFT_VOICE_AFTER_HOURS (nft_day)');

  const nftH = Number(process.env.NFT_VOICE_AFTER_HOURS);
  let nftFromCode = null;
  try {
    nftFromCode = require('../services/telegramClient').NFT_VOICE_AFTER_HOURS;
  } catch (_) {}
  console.log({ NFT_VOICE_AFTER_HOURS_env: nftH || null, NFT_VOICE_AFTER_HOURS_code: nftFromCode });

  console.log('=== PEERS WITH SENDS (14d) ===');
  console.log({ peers: byPeer.size, once, twice_plus: twicePlus, hist });

  console.log('=== MULTI-SEND PEERS ===');
  console.log(multi.slice(0, 30));

  console.log('=== INTERVALS BETWEEN SENDS (days) ===');
  if (!intervalsDays.length) {
    console.log('(no peer got 2+ sends in window)');
  } else {
    const vals = intervalsDays.map((x) => x.days).sort((a, b) => a - b);
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    console.log({
      count: vals.length,
      min: vals[0],
      median: vals[Math.floor(vals.length / 2)],
      avg: Math.round(avg * 10) / 10,
      max: vals[vals.length - 1],
      sample: intervalsDays.slice(0, 25),
    });
  }

  // Peer'ы с слотом 2 дня подряд и оба sent
  const [consec] = await db.execute(`
    SELECT a.account_id, a.peer_id, a.peer_username,
           a.send_date d1, a.image_file f1,
           b.send_date d2, b.image_file f2
    FROM daily_photo_sends a
    JOIN daily_photo_sends b
      ON a.account_id = b.account_id AND a.peer_id = b.peer_id
     AND b.send_date = DATE_ADD(a.send_date, INTERVAL 1 DAY)
    WHERE a.send_date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
      AND a.image_file IS NOT NULL AND a.image_file <> '' AND a.image_file <> '__claiming__'
      AND b.image_file IS NOT NULL AND b.image_file <> '' AND b.image_file <> '__claiming__'
    ORDER BY a.send_date DESC
    LIMIT 20
  `);
  console.log('=== BACK-TO-BACK DAYS BOTH SENT ===');
  console.log(consec);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
