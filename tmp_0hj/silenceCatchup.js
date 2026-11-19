/**
 * DB-based silence heal: last user msg already read / missed by unread scan
 * (life-lag + restart, gap after mark-as-read).
 */
const db = require('../db');
const { getActiveClient, accountLabel } = require('./clientPool');
const { isWithinWorkingHours, isNightTextQuietHour } = require('./timing');
const { isPeerBlacklisted, isNeverContact, listUserDialogs } = require('./peers');

const healInFlight = new Set();
const healedRecently = new Map(); // key → ts
const HEAL_COOLDOWN_MS = 40 * 60 * 1000;

const MEDIA_ASK_RE =
  /(?:видео|видос|круж|фот|селфи|лайф|live|запиши|скинь\s+(?:фот|вид)|пришли\s+(?:фот|вид))/i;
const MEDIA_ANSWERED_RE =
  /\[медиа:|кружок:|позже|неудоб|занята|не могу|щас\s+не|сейчас\s+не|чуть\s+позд/i;

let hooks = {
  getAccountSettings: null,
  bufferKey: null,
  getMessageBuffers: () => new Map(),
  getDeferredDialogs: () => new Map(),
  getProcessingInFlight: () => new Set(),
  getLastAnsweredMsgId: () => new Map(),
  extractIncomingText: null,
  processBufferedMessages: null,
};

function configureSilenceCatchup(next) {
  hooks = { ...hooks, ...next };
}

async function findDbSilenceGaps({ maxAgeHours = 12, minAgeMin = 3, limit = 12 } = {}) {
  // MySQL prepared INTERVAL ? HOUR ломается (Incorrect arguments) — только int в SQL.
  const hours = Math.max(1, Math.min(48, Number(maxAgeHours) || 12));
  const mins = Math.max(1, Math.min(120, Number(minAgeMin) || 3));
  const lim = Math.max(1, Math.min(40, Number(limit) || 12));
  const [rows] = await db.query(
    `SELECT cm.account_id, cm.peer_id,
            MAX(cm.peer_username) AS peer_username,
            MAX(CASE WHEN cm.role = 'user' THEN cm.created_at END) AS last_user_at,
            MAX(CASE WHEN cm.role = 'assistant' THEN cm.created_at END) AS last_bot_at,
            (
              SELECT LEFT(c2.content, 200) FROM conversation_messages c2
              WHERE c2.account_id = cm.account_id AND c2.peer_id = cm.peer_id
                AND c2.role = 'user'
              ORDER BY c2.id DESC LIMIT 1
            ) AS last_user_text
     FROM conversation_messages cm
     JOIN accounts a ON a.id = cm.account_id AND a.is_autoreply_enabled = 1
     LEFT JOIN autoreply_disabled_peers ad
       ON ad.account_id = cm.account_id AND ad.peer_id = cm.peer_id
     LEFT JOIN archived_peers ap
       ON ap.account_id = cm.account_id AND ap.peer_id = cm.peer_id
     LEFT JOIN operator_lead_flags olf
       ON olf.account_id = cm.account_id AND olf.peer_id = cm.peer_id
     WHERE ap.peer_id IS NULL
       AND ad.id IS NULL
       AND (olf.funnel_stage IS NULL OR olf.funnel_stage <> 'filtered')
     GROUP BY cm.account_id, cm.peer_id
     HAVING last_user_at IS NOT NULL
       AND last_user_at >= (NOW() - INTERVAL ${hours} HOUR)
       AND last_user_at <= (NOW() - INTERVAL ${mins} MINUTE)
       AND (last_bot_at IS NULL OR last_bot_at < last_user_at)
     ORDER BY last_user_at ASC
     LIMIT ${lim}`,
  );
  return rows;
}

function peerIdMatchesDialog(peerId, dialog) {
  const want = String(peerId);
  if (!want) return false;
  const eid = dialog?.entity?.id != null ? String(dialog.entity.id) : '';
  const did = dialog?.id != null ? String(dialog.id) : '';
  if (eid === want || did === want) return true;
  // GramJS иногда отдаёт диалог как -userId
  if (did.replace(/^-/, '') === want) return true;
  return false;
}

async function resolvePeerEntity(client, peerId, peerUsername) {
  const idNum = Number(peerId);
  const uname = String(peerUsername || '')
    .replace(/^@/, '')
    .trim();
  // Только реальный @username — emoji / «Позывной» в peer_username ломают getEntity.
  const realUname = /^[A-Za-z][\w\d_]{3,31}$/.test(uname) ? uname : '';

  const tryEntity = async (v) => {
    try {
      const input = await client.getInputEntity(v);
      return await client.getEntity(input);
    } catch (_) {
      try {
        return await client.getEntity(v);
      } catch {
        return null;
      }
    }
  };

  if (Number.isFinite(idNum) && idNum > 0) {
    const byId = await tryEntity(idNum);
    if (byId) return byId;
  }
  if (realUname) {
    const byName = await tryEntity(realUname);
    if (byName) return byName;
  }

  // Пагинация диалогов — emoji-пиры часто вне первых 200.
  try {
    const { dialogs } = await listUserDialogs(client, 800);
    const hit = (dialogs || []).find((d) => peerIdMatchesDialog(peerId, d));
    if (hit?.entity) {
      try {
        return await client.getEntity(await client.getInputEntity(hit.entity));
      } catch (_) {
        return hit.entity;
      }
    }
  } catch (e) {
    console.warn('[silenceCatchup] dialogs page:', e.message);
  }

  // Кеш сессии GramJS (если access_hash уже видели раньше).
  try {
    const cache = client._entityCache;
    if (cache && Number.isFinite(idNum)) {
      const cached = cache.get(idNum);
      if (cached) return await client.getEntity(cached);
    }
  } catch (_) {
    /* optional */
  }

  throw new Error('entity not found');
}

/** Медиа-просьба без ответа по сути (бот ушёл в «спать» / кивок). */
async function findUnfulfilledMediaGaps({ maxAgeHours = 12, limit = 8 } = {}) {
  const hours = Math.max(1, Math.min(48, Number(maxAgeHours) || 12));
  const lim = Math.max(1, Math.min(40, Number(limit) || 8));
  const [rows] = await db.query(
    `SELECT cm.account_id, cm.peer_id,
            MAX(cm.peer_username) AS peer_username,
            MAX(CASE WHEN cm.role = 'user' THEN cm.created_at END) AS last_user_at,
            MAX(CASE WHEN cm.role = 'assistant' THEN cm.created_at END) AS last_bot_at,
            (
              SELECT LEFT(c2.content, 200) FROM conversation_messages c2
              WHERE c2.account_id = cm.account_id AND c2.peer_id = cm.peer_id
                AND c2.role = 'user'
              ORDER BY c2.id DESC LIMIT 1
            ) AS last_user_text,
            (
              SELECT LEFT(c3.content, 200) FROM conversation_messages c3
              WHERE c3.account_id = cm.account_id AND c3.peer_id = cm.peer_id
                AND c3.role = 'assistant'
              ORDER BY c3.id DESC LIMIT 1
            ) AS last_bot_text
     FROM conversation_messages cm
     JOIN accounts a ON a.id = cm.account_id AND a.is_autoreply_enabled = 1
     LEFT JOIN autoreply_disabled_peers ad
       ON ad.account_id = cm.account_id AND ad.peer_id = cm.peer_id
     LEFT JOIN archived_peers ap
       ON ap.account_id = cm.account_id AND ap.peer_id = cm.peer_id
     WHERE ap.peer_id IS NULL AND ad.id IS NULL
     GROUP BY cm.account_id, cm.peer_id
     HAVING last_user_at IS NOT NULL
       AND last_user_at >= (NOW() - INTERVAL ${hours} HOUR)
       AND last_user_at <= (NOW() - INTERVAL 2 MINUTE)
     ORDER BY last_user_at ASC
     LIMIT 40`,
  );
  return (rows || [])
    .filter((r) => MEDIA_ASK_RE.test(String(r.last_user_text || '')))
    .filter((r) => !MEDIA_ANSWERED_RE.test(String(r.last_bot_text || '')))
    .slice(0, lim);
}

async function healOneGap(row) {
  const accountId = row.account_id;
  const peerId = String(row.peer_id);
  const key = `${accountId}:${peerId}`;
  if (healInFlight.has(key)) return false;
  const prev = healedRecently.get(key) || 0;
  const mediaSeedEarly = MEDIA_ASK_RE.test(String(row.last_user_text || ''));
  const coolMs = mediaSeedEarly ? 8 * 60 * 1000 : HEAL_COOLDOWN_MS;
  if (Date.now() - prev < coolMs) return false;

  if (!isWithinWorkingHours(accountId)) return false;
  if (isNightTextQuietHour()) return false;

  const client = getActiveClient(accountId);
  if (!client) return false;

  const settings = await hooks.getAccountSettings(accountId);
  if (!settings || !settings.is_autoreply_enabled) return false;
  if (await isPeerBlacklisted(accountId, peerId)) return false;

  const bufKey = hooks.bufferKey(accountId, peerId);
  if (hooks.getMessageBuffers().has(bufKey)) return false;
  if (hooks.getDeferredDialogs().has(bufKey)) return false;
  if (hooks.getProcessingInFlight().has(bufKey)) return false;

  healInFlight.add(key);
  try {
    let entity;
    try {
      entity = await resolvePeerEntity(client, peerId, row.peer_username);
    } catch (e2) {
      console.warn(
        `[${accountLabel(accountId)}] silence-heal: entity ${peerId}:`,
        e2.message,
      );
      return false;
    }
    if (!entity || entity.bot || entity.self || isNeverContact(entity)) return false;

    const msgs = await client.getMessages(entity, { limit: 25 });
    const inbound = (msgs || []).find((m) => m && !m.out);
    if (!inbound) return false;

    let text;
    try {
      text = await hooks.extractIncomingText(accountId, inbound);
    } catch (_) {
      text = inbound.message || '';
    }
    // Soft media: в БД просьба видео, а бот ушёл в «спать»/кивок без ответа по сути.
    const dbAsk = String(row.last_user_text || '').trim();
    const seedText = String(text || dbAsk || '').trim();
    if (!seedText) return false;

    const lastOut = (msgs || []).find((m) => m && m.out);
    const lastOutText = String(lastOut?.message || row.last_bot_text || '');
    const mediaSoftNeed =
      MEDIA_ASK_RE.test(dbAsk || seedText) && !MEDIA_ANSWERED_RE.test(lastOutText);

    // Уже ответили в TG (out после этого id) — БД отстаёт, не дублируем.
    // Исключение: «спали» / кивок поверх незакрытой медиа-просьбы.
    const answeredInTg = (msgs || []).some(
      (m) => m && m.out && Number(m.id) > Number(inbound.id),
    );
    if (answeredInTg && !mediaSoftNeed) {
      healedRecently.set(key, Date.now());
      return false;
    }

    text = mediaSoftNeed && MEDIA_ASK_RE.test(dbAsk) ? dbAsk : seedText;

    // Сброс ложного «уже отвечено» после оборванной паузы.
    try {
      const answeredMap = hooks.getLastAnsweredMsgId();
      const prevAns = answeredMap.get(bufKey);
      if (prevAns != null && Number(prevAns) >= Number(inbound.id)) {
        answeredMap.delete(bufKey);
      }
    } catch (_) {
      /* optional */
    }

    const senderName = entity.username || entity.firstName || peerId;
    console.log(
      `[${accountLabel(accountId)}] silence-heal: догоняю прочитанную тишину с ${senderName}: ` +
        `"${String(text).replace(/\s+/g, ' ').slice(0, 80)}"`,
    );

    await hooks.processBufferedMessages(
      accountId,
      entity,
      inbound,
      peerId,
      senderName,
      String(text).trim(),
    );
    healedRecently.set(key, Date.now());
    return true;
  } catch (e) {
    console.error(
      `[${accountLabel(accountId)}] silence-heal fail peer=${peerId}:`,
      e.message,
    );
    return false;
  } finally {
    healInFlight.delete(key);
  }
}

async function runSilenceCatchupHeal({ limit = 8 } = {}) {
  if (isNightTextQuietHour()) return { healed: 0, skipped: 'night' };
  let gaps = [];
  let mediaGaps = [];
  try {
    gaps = await findDbSilenceGaps({ maxAgeHours: 12, minAgeMin: 3, limit });
  } catch (e) {
    console.error('[silenceCatchup] query:', e.message);
    return { healed: 0, error: e.message };
  }
  try {
    mediaGaps = await findUnfulfilledMediaGaps({ maxAgeHours: 12, limit: 6 });
  } catch (e) {
    console.warn('[silenceCatchup] media-gaps:', e.message);
  }

  const seen = new Set();
  const merged = [];
  for (const row of [...mediaGaps, ...gaps]) {
    const k = `${row.account_id}:${row.peer_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(row);
  }

  let healed = 0;
  for (const row of merged) {
    // Прощания / чистый сон — не будим (кроме незакрытой медиа-просьбы)
    const t = String(row.last_user_text || '');
    const mediaAsk = MEDIA_ASK_RE.test(t);
    if (
      !mediaAsk &&
      /^(?:я\s+)?спать\b|спокойной\s+ночи|до\s+завтра|пока\b/i.test(t.trim())
    ) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const ok = await healOneGap(row);
    if (ok) healed += 1;
    if (healed >= limit) break;
  }
  if (healed > 0) {
    console.log(
      `[silenceCatchup] healed ${healed} gap(s) (scanned ${merged.length}, mediaSoft=${mediaGaps.length})`,
    );
  }
  return { healed, scanned: merged.length, mediaSoft: mediaGaps.length };
}

module.exports = {
  configureSilenceCatchup,
  findDbSilenceGaps,
  findUnfulfilledMediaGaps,
  runSilenceCatchupHeal,
  healOneGap,
  resolvePeerEntity,
};
