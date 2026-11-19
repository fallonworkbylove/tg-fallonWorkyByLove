#!/usr/bin/env node
/**
 * Аудит daily flip: env, папки, слоты, последние отправки, skip-причины.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function listImages(folders) {
  const out = [];
  for (const folder of folders) {
    if (!folder || !fs.existsSync(folder)) {
      out.push({ folder, ok: false, files: [] });
      continue;
    }
    const files = fs
      .readdirSync(folder)
      .filter((n) => IMAGE_EXTENSIONS.has(path.extname(n).toLowerCase()));
    out.push({ folder, ok: true, files });
  }
  return out;
}

function zonedParts(date = new Date()) {
  const tz = process.env.WORK_TIMEZONE || 'Europe/Moscow';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );
  return {
    tz,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

(async () => {
  const start = Number(process.env.DAILY_PHOTO_START_HOUR || 14);
  const end = Number(process.env.DAILY_PHOTO_END_HOUR || 16);
  const p = zonedParts();
  const mskDate = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  const inWindow = p.hour >= start && p.hour < end;

  const ru = [process.env.IMAGES_FOLDER, process.env.IMAGES_FOLDER_2].filter(Boolean);
  const en = [process.env.IMAGES_FOLDER_EN, process.env.IMAGES_FOLDER_EN_2].filter(Boolean);

  console.log('=== CONFIG ===');
  console.log({
    now_utc: new Date().toISOString(),
    now_msk: `${mskDate} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`,
    window: `${start}:00-${end}:00 ${p.tz}`,
    in_window_now: inWindow,
    folders_ru: ru,
    folders_en: en,
  });

  console.log('=== ASSETS ===');
  console.log('RU', listImages(ru));
  console.log('EN', listImages(en));

  const [byDate] = await db.execute(`
    SELECT send_date,
      COUNT(*) AS total,
      SUM(sent_at IS NOT NULL AND image_file IS NOT NULL AND image_file <> '' AND image_file <> '__claiming__') AS sent,
      SUM(sent_at IS NOT NULL AND (image_file IS NULL OR image_file = '')) AS skipped_closed,
      SUM(sent_at IS NULL) AS pending,
      SUM(image_file = '__claiming__') AS claiming
    FROM daily_photo_sends
    WHERE send_date >= DATE_SUB(CURDATE(), INTERVAL 5 DAY)
    GROUP BY send_date
    ORDER BY send_date DESC
  `);
  console.log('=== BY DATE (server CURDATE) ===');
  console.log(byDate);

  const [todayMsk] = await db.execute(
    `
    SELECT
      COUNT(*) AS total,
      SUM(sent_at IS NOT NULL AND image_file IS NOT NULL AND image_file <> '' AND image_file <> '__claiming__') AS sent,
      SUM(sent_at IS NOT NULL AND (image_file IS NULL OR image_file = '')) AS skipped_closed,
      SUM(sent_at IS NULL) AS pending
    FROM daily_photo_sends
    WHERE send_date = ?
  `,
    [mskDate],
  );
  console.log('=== TODAY MSK', mskDate, '===');
  console.log(todayMsk[0]);

  const [recent] = await db.execute(`
    SELECT account_id, peer_id, peer_username, send_date, scheduled_at, sent_at, image_file
    FROM daily_photo_sends
    WHERE sent_at IS NOT NULL
      AND image_file IS NOT NULL AND image_file <> '' AND image_file <> '__claiming__'
    ORDER BY sent_at DESC
    LIMIT 20
  `);
  console.log('=== RECENT SENT ===');
  console.log(recent);

  const [pending] = await db.execute(
    `
    SELECT account_id, peer_id, peer_username, send_date, scheduled_at, sent_at, image_file
    FROM daily_photo_sends
    WHERE send_date = ? AND sent_at IS NULL
    ORDER BY scheduled_at
    LIMIT 30
  `,
    [mskDate],
  );
  console.log('=== PENDING TODAY ===');
  console.log(pending);

  const [skipped] = await db.execute(
    `
    SELECT account_id, peer_id, peer_username, scheduled_at, sent_at, image_file
    FROM daily_photo_sends
    WHERE send_date = ? AND sent_at IS NOT NULL
      AND (image_file IS NULL OR image_file = '')
    ORDER BY sent_at DESC
    LIMIT 20
  `,
    [mskDate],
  );
  console.log('=== SKIPPED/CLOSED TODAY (no image_file) ===');
  console.log(skipped);

  // Дубли отправок в один день (не должно быть из-за UNIQUE)
  const [dups] = await db.execute(`
    SELECT account_id, peer_id, send_date, COUNT(*) c
    FROM daily_photo_sends
    GROUP BY account_id, peer_id, send_date
    HAVING c > 1
    LIMIT 10
  `);
  console.log('=== DUP SLOTS (should be empty) ===');
  console.log(dups);

  // Повторы одного файла одному peer
  const [fileReuse] = await db.execute(`
    SELECT account_id, peer_id, image_file, COUNT(*) c
    FROM daily_photo_sends
    WHERE image_file IS NOT NULL AND image_file <> '' AND image_file <> '__claiming__'
    GROUP BY account_id, peer_id, image_file
    HAVING c > 1
    LIMIT 10
  `);
  console.log('=== SAME FILE REUSED PER PEER (should be empty if exclude works) ===');
  console.log(fileReuse);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
