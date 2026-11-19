#!/usr/bin/env node
/**
 * Почему не кидает тем, кто НЕ в архиве: разбор сегодняшних слотов
 * + повторный shouldSkip / idle / activeChat для живых peer'ов.
 */
require('dotenv').config();
const db = require('../db');

(async () => {
  const {
    getActiveClient,
    isPeerArchived,
    lastIncomingAgeMin,
    getDialogAgeHours,
    NFT_VOICE_AFTER_HOURS,
  } = require('../services/telegramClient');
  const daily = require('../services/dailyPhotos');

  // shouldSkip не экспортирован — дублируем ключевые пороги для отчёта
  const LIVE_DIALOG_MAX_IDLE_MIN = 60;
  const ACTIVE_CHAT_QUIET_MIN = 10;

  const tz = process.env.WORK_TIMEZONE || 'Europe/Moscow';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour12: false,
    })
      .formatToParts(new Date())
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );
  const mskDate = `${parts.year}-${parts.month.padStart(2, '0')}-${parts.day.padStart(2, '0')}`;

  const [rows] = await db.execute(
    `
    SELECT id, account_id, peer_id, peer_username, scheduled_at, sent_at, image_file
    FROM daily_photo_sends
    WHERE send_date = ?
    ORDER BY scheduled_at
  `,
    [mskDate],
  );

  console.log('=== TODAY', mskDate, 'slots', rows.length, '===');

  // Причины из логов за сегодня (если есть) — парсим out log хвост
  const fs = require('fs');
  let logReasons = {};
  try {
    const log = fs.readFileSync('/root/.pm2/logs/tgbot-out.log', 'utf8');
    const re =
      /\[Аккаунт (\d+)\] Ежедневное фото пропущено \(([^)]+)\) для (\d+)/g;
    let m;
    const todayHint = mskDate.replace(/-/g, ''); // rough; log has no date — take last N matches
    const matches = [];
    while ((m = re.exec(log)) !== null) {
      matches.push({ account_id: Number(m[1]), reason: m[2], peer_id: m[3] });
    }
    // последние 200 пропусков
    for (const x of matches.slice(-200)) {
      const k = `${x.account_id}:${x.peer_id}`;
      logReasons[k] = x.reason;
    }
  } catch (e) {
    console.log('log parse fail', e.message);
  }

  const summary = {
    sent: 0,
    skipped_no_file: 0,
    pending: 0,
    by_log_reason: {},
    not_archived_skipped: [],
    archived_skipped: [],
    sent_list: [],
  };

  for (const row of rows) {
    const wasSent =
      row.sent_at &&
      row.image_file &&
      row.image_file !== '' &&
      row.image_file !== '__claiming__';
    const wasSkipped = row.sent_at && (!row.image_file || row.image_file === '');
    if (wasSent) {
      summary.sent += 1;
      summary.sent_list.push({
        account_id: row.account_id,
        peer: row.peer_username || row.peer_id,
        file: row.image_file,
      });
      continue;
    }
    if (!row.sent_at) {
      summary.pending += 1;
      continue;
    }
    summary.skipped_no_file += 1;

    const key = `${row.account_id}:${row.peer_id}`;
    const reasonFromLog = logReasons[key] || 'unknown_closed';
    summary.by_log_reason[reasonFromLog] =
      (summary.by_log_reason[reasonFromLog] || 0) + 1;

    // Живые проверки сейчас
    let archived = null;
    let idle = null;
    let age = null;
    let lastRole = null;
    let lastAgeMin = null;
    try {
      const client = getActiveClient(row.account_id);
      if (client) {
        try {
          const entity = await client.getEntity(Number(row.peer_id));
          archived = await isPeerArchived(client, entity);
        } catch (_) {
          archived = 'entity_fail';
        }
      } else {
        archived = 'no_client';
      }
      idle = await lastIncomingAgeMin(row.account_id, row.peer_id);
      age = await getDialogAgeHours(row.account_id, row.peer_id);

      const [[last]] = await db.execute(
        `SELECT role, TIMESTAMPDIFF(MINUTE, created_at, NOW()) AS age_min
         FROM conversation_messages
         WHERE account_id = ? AND peer_id = ?
         ORDER BY id DESC LIMIT 1`,
        [row.account_id, String(row.peer_id)],
      );
      if (last) {
        lastRole = last.role;
        lastAgeMin = Number(last.age_min);
      }
    } catch (e) {
      archived = `err:${e.message}`;
    }

    const entry = {
      account_id: row.account_id,
      peer: row.peer_username || row.peer_id,
      peer_id: row.peer_id,
      reason: reasonFromLog,
      archived_now: archived,
      idle_min_now: idle,
      age_h: age == null ? null : Math.round(age * 10) / 10,
      nft_cut: NFT_VOICE_AFTER_HOURS,
      last_role: lastRole,
      last_age_min: lastAgeMin,
      scheduled_at: row.scheduled_at,
    };

    if (archived === true) summary.archived_skipped.push(entry);
    else summary.not_archived_skipped.push(entry);
  }

  console.log('=== SUMMARY ===');
  console.log({
    sent: summary.sent,
    skipped: summary.skipped_no_file,
    pending: summary.pending,
    by_log_reason: summary.by_log_reason,
    skipped_archived_now: summary.archived_skipped.length,
    skipped_NOT_archived_now: summary.not_archived_skipped.length,
  });

  console.log('=== NOT ARCHIVED but skipped (why) ===');
  // группировка
  const g = {};
  for (const e of summary.not_archived_skipped) {
    g[e.reason] = (g[e.reason] || 0) + 1;
  }
  console.log('reasons', g);
  console.log(summary.not_archived_skipped.slice(0, 25));

  console.log('=== ARCHIVED skipped ===');
  console.log(summary.archived_skipped.slice(0, 10));

  console.log('=== THRESHOLDS ===');
  console.log({
    LIVE_DIALOG_MAX_IDLE_MIN,
    ACTIVE_CHAT_QUIET_MIN,
    NFT_VOICE_AFTER_HOURS,
    too_early_lt: 20,
  });

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
