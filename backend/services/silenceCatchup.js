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
const healFailCooldown = new Map(); // key → ts (после Connection error / fail)
const HEAL_COOLDOWN_MS = 40 * 60 * 1000;
const HEAL_FAIL_COOLDOWN_MS = 12 * 60 * 1000;
const META_USER_RE = /^\[уточнение\b/i;
// Звонок / «бери трубку» — текст-heal только шумит; пусть оператор, не крутим каждые 5м.
const CALL_ONLY_RE =
  /^(?:бери\s+трубку|подними\s+трубку|возьми\s+трубку|позвони(?:\s+мне)?|набери(?:\s+мне)?|дай\s+номер|скинь\s+номер|ответь\s+на\s+звонок)[.!?…)\s]*$/i;
// Мягкий хвост / обвинение в боте — не догоняем и не орём в «ждут».
const SOFT_CLOSE_RE =
  /^(?:понятно|понял|ок|окей|ладно|угу|ага|ясно|ну\s+ок)[.!?…)\s]*$/i;
/** Прощания / сон — не догоняем silence-heal (иначе «Сладких снов» → голос). */
const NIGHT_BYE_RE =
  /^(?:спокойной(?:\s+ноч(?:и|ки))?|сладких\s+снов|доброй\s+ноч(?:и|ки)|я\s+(?:ид[уё]?\s+)?спать|пойду\s+спать|сплю|до\s+завтра|пока|ппк|бай|bb)[.!?…)\s💕❤️✨]*$/i;
const BOT_ACCUSE_RE =
  /(?:^|\b)(?:ты\s+(?:бот|ии|нейро)|привет[,.\s]*ии|боты?\s+заеб|это\s+бот)/i;

function pruneHealedRecently(now = Date.now()) {
  const ttl = HEAL_COOLDOWN_MS * 3;
  for (const [k, ts] of healedRecently) {
    if (now - ts > ttl) healedRecently.delete(k);
  }
  for (const [k, ts] of healFailCooldown) {
    if (now - ts > HEAL_FAIL_COOLDOWN_MS * 3) healFailCooldown.delete(k);
  }
}

// Только явная просьба записать/скинуть — не «пересматриваю кружок».
const MEDIA_ASK_RE =
  /(?:можешь|скинь|запиши|пришли|покажи|хочу|дай).{0,48}(?:видео|видос|круж|фот|селфи|лайф|live)|(?:видео|видос|кружок|фотку|селфи|лайф).{0,24}(?:запиш|скинь|пришли|можешь)/i;
const MEDIA_ANSWERED_RE =
  /\[медиа:|кружок:|позже|неудоб|занята|не могу|щас\s+не|сейчас\s+не|чуть\s+позд|не\s+могу\s+сейчас|давай\s+чуть|сначала\s+ты|сперва\s+ты|ты\s+перв|не\s+собач/i;

let hooks = {
  getAccountSettings: null,
  bufferKey: null,
  getMessageBuffers: () => new Map(),
  getDeferredDialogs: () => new Map(),
  getProcessingInFlight: () => new Set(),
  getLastAnsweredMsgId: () => new Map(),
  extractIncomingText: null,
  processBufferedMessages: null,
  saveMessage: null,
};

function configureSilenceCatchup(next) {
  hooks = { ...hooks, ...next };
}

async function findDbSilenceGaps({ maxAgeHours = 12, minAgeMin = 3, limit = 12 } = {}) {
  // MySQL prepared INTERVAL ? HOUR ломается (Incorrect arguments) — только int в SQL.
  // Кандидаты = недавние user-сообщения (не полный GROUP BY всей истории).
  const hours = Math.max(1, Math.min(48, Number(maxAgeHours) || 12));
  const mins = Math.max(1, Math.min(120, Number(minAgeMin) || 3));
  const lim = Math.max(1, Math.min(40, Number(limit) || 12));
  const [rows] = await db.query(
    `SELECT c.account_id, c.peer_id,
            (SELECT MAX(cm.peer_username) FROM conversation_messages cm
              WHERE cm.account_id = c.account_id AND cm.peer_id = c.peer_id
                AND cm.created_at >= (NOW() - INTERVAL ${hours} HOUR)) AS peer_username,
            c.last_user_at,
            (SELECT MAX(b.created_at) FROM conversation_messages b
              WHERE b.account_id = c.account_id AND b.peer_id = c.peer_id
                AND b.role = 'assistant') AS last_bot_at,
            (SELECT LEFT(u.content, 200) FROM conversation_messages u
              WHERE u.account_id = c.account_id AND u.peer_id = c.peer_id
                AND u.role = 'user'
              ORDER BY u.id DESC LIMIT 1) AS last_user_text
     FROM (
       SELECT account_id, peer_id, MAX(created_at) AS last_user_at
       FROM conversation_messages
       WHERE role = 'user'
         AND created_at >= (NOW() - INTERVAL ${hours} HOUR)
         AND created_at <= (NOW() - INTERVAL ${mins} MINUTE)
       GROUP BY account_id, peer_id
     ) c
     JOIN accounts a ON a.id = c.account_id AND a.is_autoreply_enabled = 1
     LEFT JOIN autoreply_disabled_peers ad
       ON ad.account_id = c.account_id AND ad.peer_id = c.peer_id
     LEFT JOIN archived_peers ap
       ON ap.account_id = c.account_id AND ap.peer_id = c.peer_id
     LEFT JOIN operator_lead_flags olf
       ON olf.account_id = c.account_id AND olf.peer_id = c.peer_id
     LEFT JOIN nft_voice_schedule nvs
       ON nvs.account_id = c.account_id AND nvs.peer_id = c.peer_id
     WHERE ap.peer_id IS NULL
       AND ad.id IS NULL
       AND (olf.funnel_stage IS NULL OR olf.funnel_stage NOT IN ('filtered','operator'))
       AND NOT EXISTS (
         SELECT 1 FROM conversation_messages b
         WHERE b.account_id = c.account_id AND b.peer_id = c.peer_id
           AND b.role = 'assistant' AND b.created_at >= c.last_user_at
       )
     ORDER BY
       CASE WHEN olf.focus = 1 OR olf.funnel_stage IN ('hot','ready','lead') THEN 1 ELSE 0 END DESC,
       CASE WHEN nvs.work_mention_sent = 1 OR nvs.scheduled_at IS NOT NULL THEN 1 ELSE 0 END DESC,
       c.last_user_at ASC
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
    `SELECT c.account_id, c.peer_id,
            (SELECT MAX(cm.peer_username) FROM conversation_messages cm
              WHERE cm.account_id = c.account_id AND cm.peer_id = c.peer_id
                AND cm.created_at >= (NOW() - INTERVAL ${hours} HOUR)) AS peer_username,
            c.last_user_at,
            (SELECT LEFT(u.content, 200) FROM conversation_messages u
              WHERE u.account_id = c.account_id AND u.peer_id = c.peer_id
                AND u.role = 'user'
              ORDER BY u.id DESC LIMIT 1) AS last_user_text,
            (SELECT LEFT(b.content, 200) FROM conversation_messages b
              WHERE b.account_id = c.account_id AND b.peer_id = c.peer_id
                AND b.role = 'assistant'
              ORDER BY b.id DESC LIMIT 1) AS last_bot_text
     FROM (
       SELECT account_id, peer_id, MAX(created_at) AS last_user_at
       FROM conversation_messages
       WHERE role = 'user'
         AND created_at >= (NOW() - INTERVAL ${hours} HOUR)
         AND created_at <= (NOW() - INTERVAL 2 MINUTE)
       GROUP BY account_id, peer_id
     ) c
     JOIN accounts a ON a.id = c.account_id AND a.is_autoreply_enabled = 1
     LEFT JOIN autoreply_disabled_peers ad
       ON ad.account_id = c.account_id AND ad.peer_id = c.peer_id
     LEFT JOIN archived_peers ap
       ON ap.account_id = c.account_id AND ap.peer_id = c.peer_id
     WHERE ap.peer_id IS NULL AND ad.id IS NULL
     ORDER BY c.last_user_at ASC
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
  const lastUserText = String(row.last_user_text || '');
  // Служебные пометки в БД («[уточнение…]») — не живой входящий, не будим.
  if (META_USER_RE.test(lastUserText.trim())) return false;
  if (CALL_ONLY_RE.test(lastUserText.trim())) return false;
  if (SOFT_CLOSE_RE.test(lastUserText.trim())) return false;
  if (NIGHT_BYE_RE.test(lastUserText.trim())) return false;
  if (BOT_ACCUSE_RE.test(lastUserText)) return false;
  const prev = healedRecently.get(key) || 0;
  const mediaSeedEarly = MEDIA_ASK_RE.test(lastUserText);
  // Прямой вопрос (? / работа / зачем сюда) — догон быстрее, как медиа.
  let directAskEarly = /\?\s*$/.test(lastUserText.trim()) && lastUserText.trim().length >= 12;
  try {
    const soft = require('./softHumanLite');
    const jf = require('./jobFlipAsk');
    if (
      (jf.isJobOccupationAsk && jf.isJobOccupationAsk(lastUserText)) ||
      (soft.isWhyHereAsk && soft.isWhyHereAsk(lastUserText))
    ) {
      directAskEarly = true;
    }
  } catch (_) {
    /* optional */
  }
  const coolMs = mediaSeedEarly || directAskEarly ? 8 * 60 * 1000 : HEAL_COOLDOWN_MS;
  if (Date.now() - prev < coolMs) return false;
  const failPrev = healFailCooldown.get(key) || 0;
  if (Date.now() - failPrev < HEAL_FAIL_COOLDOWN_MS) return false;

  // Ночная тишина 01–08 МСК — всегда.
  // После «режима дня» аккаунта (часто ~23) до 01 всё равно догоняем СТАРЫЕ дыры,
  // иначе пуш «ждут ответа» орёт, а heal молчит до утра.
  if (isNightTextQuietHour()) return false;
  if (!isWithinWorkingHours(accountId) && !mediaSeedEarly) {
    const ageMin = row.last_user_at
      ? (Date.now() - new Date(row.last_user_at).getTime()) / 60000
      : 999;
    if (ageMin < 20) return false;
  }

  const client = getActiveClient(accountId);
  if (!client) return false;

  const settings = await hooks.getAccountSettings(accountId);
  if (!settings || !settings.is_autoreply_enabled) return false;
  if (await isPeerBlacklisted(accountId, peerId)) return false;

  const bufKey = hooks.bufferKey(accountId, peerId);
  if (hooks.getMessageBuffers().has(bufKey)) return false;
  if (hooks.getDeferredDialogs().has(bufKey)) return false;
  if (hooks.getProcessingInFlight().has(bufKey)) return false;
  // fireReengage уже генерит (ключ снят с deferred) — не ставим вторую «Занята».
  try {
    const { reengageInFlight } = require('./inbound');
    if (reengageInFlight && reengageInFlight.has(bufKey)) return false;
  } catch (_) {
    /* optional */
  }

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
      // БД отстаёт от TG — иначе «ждут ответа» орёт вечно при живом out в чате.
      try {
        if (typeof hooks.saveMessage === 'function' && lastOut) {
          const syncText = String(lastOut.message || '').trim();
          if (syncText) {
            await hooks.saveMessage(
              accountId,
              peerId,
              row.peer_username || null,
              'assistant',
              syncText.slice(0, 500),
            );
            console.log(
              `[${accountLabel(accountId)}] silence-heal: sync TG→DB peer=${peerId}`,
            );
          }
        }
      } catch (eSync) {
        console.warn(
          `[${accountLabel(accountId)}] silence-heal sync fail:`,
          eSync.message,
        );
      }
      healedRecently.set(key, Date.now());
      healFailCooldown.delete(key);
      return true;
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
    try {
      require('./opsLiveMetrics').bump('silenceHeal');
    } catch (_) {}

    await hooks.processBufferedMessages(
      accountId,
      entity,
      inbound,
      peerId,
      senderName,
      String(text).trim(),
    );
    // Если ушли в «Занята»/буфер — не ставим 40м cooldown: иначе дыра висит часами.
    const stillPending =
      hooks.getDeferredDialogs().has(bufKey) ||
      hooks.getMessageBuffers().has(bufKey) ||
      (hooks.getProcessingInFlight && hooks.getProcessingInFlight().has(bufKey));
    if (stillPending) {
      healFailCooldown.set(key, Date.now());
      console.log(
        `[${accountLabel(accountId)}] silence-heal: в очереди/Занята peer=${peerId} — короткий cooldown`,
      );
      return true;
    }
    healedRecently.set(key, Date.now());
    healFailCooldown.delete(key);
    return true;
  } catch (e) {
    healFailCooldown.set(key, Date.now());
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
  pruneHealedRecently();
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
    if (!mediaAsk && /^[.!?…]+$/u.test(t.trim())) {
      continue;
    }
    if (!mediaAsk && SOFT_CLOSE_RE.test(t.trim())) {
      continue;
    }
    if (!mediaAsk && BOT_ACCUSE_RE.test(t)) {
      continue;
    }
    if (
      !mediaAsk &&
      /^(?:я\s+)?спать\b|спокойной\s+ночи|до\s+завтра|(?:^|[,.!\s])пока\b/i.test(
        t.trim(),
      )
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

/** После Connection error / transport — разрешить silence-heal быстрее догнать дыру. */
function noteTransportMiss(accountId, peerId) {
  const key = `${accountId}:${String(peerId)}`;
  healFailCooldown.delete(key);
  // Не блокируем heal полным cooldown — через ~1м можно догнать.
  healedRecently.set(key, Date.now() - HEAL_COOLDOWN_MS + 60_000);
}

module.exports = {
  configureSilenceCatchup,
  findDbSilenceGaps,
  findUnfulfilledMediaGaps,
  runSilenceCatchupHeal,
  healOneGap,
  resolvePeerEntity,
  noteTransportMiss,
};
