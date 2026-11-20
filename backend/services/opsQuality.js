/**
 * opsQuality (0gc): причины отсева, темп по score, тишина-реакция,
 * слот суток для медиа, дайджест отсева, алерт «AI замолчал».
 */
const db = require('../db');

/** Автоотсев: howlong ≥21д + молчит 2д. */
const FILTER_REASONS = {
  howlong: 'давно на дв',
  silent: 'молчит 2д',
  manual: 'вручную',
  other: 'отсев',
};

function formatFilterNote(reasonKey, detail = '') {
  const label = FILTER_REASONS[reasonKey] || FILTER_REASONS.other;
  const extra = String(detail || '').trim();
  const note = extra ? `отсев: ${label} · ${extra}` : `отсев: ${label}`;
  return note.slice(0, 240);
}

function parseFilterReason(note) {
  const n = String(note || '');
  if (/давно\s+на\s+дв|на\s+дв\s+\d+/i.test(n)) return 'howlong';
  if (/молчит/i.test(n)) return 'silent';
  if (/вручную/i.test(n)) return 'manual';
  if (/^отсев:/i.test(n)) return 'other';
  return null;
}

/**
 * #4 score → темп: cold медленнее + реже медиа; hot быстрее.
 * delayMult умножает паузу перед ответом; mediaChance — шанс разрешить
 * не-запрошенное медиа (contextual circle / proactive).
 */
function tempoForLeadTier(tier) {
  const t = String(tier || 'cold');
  if (t === 'hot') {
    return { delayMult: 0.75, mediaChance: 0.85, shortBias: false, label: 'hot' };
  }
  if (t === 'warm') {
    return { delayMult: 1.0, mediaChance: 0.55, shortBias: false, label: 'warm' };
  }
  return { delayMult: 1.15, mediaChance: 0.22, shortBias: true, label: 'cold' };
}

function applyTempoDelay(baseMs, tier) {
  const { delayMult } = tempoForLeadTier(tier);
  const n = Number(baseMs) || 0;
  return Math.max(400, Math.round(n * delayMult));
}

function allowProactiveMedia(tier, explicitRequest) {
  if (explicitRequest) return true;
  return Math.random() < tempoForLeadTier(tier).mediaChance;
}

/** #7 короткие входящие → только реакция (15–40%). */
const SHORT_ACK_RE =
  /^(?:ну\s+|да\s+)?(?:ок|окей|ага|угу|ладно|хорошо|норм|кайф|пон|понял|поняла|ясно|принято|спс|спасибо|👍|🔥|😂|😅)\s*[)!.]*$/i;

function preferSilentReaction(userMessage, { leadTier = 'cold', forceBareOk = false } = {}) {
  const t = String(userMessage || '')
    .replace(/^\[[^\]]*\]:\s*/g, '')
    .trim();
  if (!t || t.length > 28) return false;
  if (/[?]/.test(t)) return false;
  // Только явные кивки (ок/ага/…). «Как и вчера» / короткие факты — НЕ молчаливая реакция.
  if (!SHORT_ACK_RE.test(t)) return false;
  if (forceBareOk) return true;
  // #8 чаще реакция вместо текста (cold чаще кивает молча)
  const p = leadTier === 'hot' ? 0.28 : leadTier === 'warm' ? 0.4 : 0.52;
  return Math.random() < p;
}

/** #8 слот суток МСК: morning / day / evening / night */
function mediaTimeSlot(date = new Date()) {
  const msk = new Date(date.getTime() + 3 * 3600 * 1000);
  const h = msk.getUTCHours() + msk.getUTCMinutes() / 60;
  if (h >= 6 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'day';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

/**
 * Приоритет light-тега под слот. banned — что точно нельзя.
 * morning/day → ban dark; evening/night → ban day.
 */
function mediaSlotPolicy(date = new Date()) {
  const slot = mediaTimeSlot(date);
  if (slot === 'morning' || slot === 'day') {
    return { slot, banned: 'dark', prefer: 'day' };
  }
  return { slot, banned: 'day', prefer: 'dark' };
}

function sortMediaBySlotPrefer(items, link, cachedLightFn, prefer) {
  if (!prefer || !items?.length) return items;
  const scored = items.map((i) => {
    const light = cachedLightFn(i, link);
    let score = 0;
    if (light === prefer) score = 2;
    else if (!light) score = 1;
    else score = 0;
    return { i, score };
  });
  scored.sort((a, b) => b.score - a.score || Math.random() - 0.5);
  return scored.map((x) => x.i);
}

// --- #9 дайджест отсева + #11 AI замолчал + proxy/session watchdog ---
let digestTimer = null;
let silenceTimer = null;
let proxyWatchTimer = null;
let sessionWatchTimer = null;
let nftFunnelTimer = null;
let openaiWatchTimer = null;
let offlineWatchTimer = null;
let flushTimer = null;
let lastDigestDay = '';
let lastProxyAlertAt = 0;
let lastOpenAiAlertAt = 0;
let lastOfflineAlertAt = 0;
let lastOpenAiOk = true;
let lastSessionAlertAt = 0;
let lastNftStuckAlertAt = 0;
let lastAuthKeyAlertAt = 0;
const silenceAlerted = new Map(); // key account:peer → ts
const MIN_PROXY_LEN = Number(process.env.PROXY_WATCH_MIN) || 5;
const MIN_ACTIVE_SESSIONS = Number(process.env.SESSION_WATCH_MIN) || 8;
const authKeyHits = new Map(); // accountId → last ts

function noteAuthKeyDuplicated(accountId) {
  if (accountId == null) return;
  authKeyHits.set(Number(accountId), Date.now());
}

function pruneOpsMaps(now = Date.now()) {
  for (const [k, ts] of silenceAlerted) {
    if (now - ts > 6 * 60 * 60 * 1000) silenceAlerted.delete(k);
  }
  for (const [k, ts] of authKeyHits) {
    if (now - ts > 2 * 60 * 60 * 1000) authKeyHits.delete(k);
  }
}

async function runFilteredDigest() {
  const msk = new Date(Date.now() + 3 * 3600 * 1000);
  const day = msk.toISOString().slice(0, 10);
  const hour = msk.getUTCHours();
  // Раз в день около 21:00 МСК
  if (hour < 21 || hour > 22) return;
  if (lastDigestDay === day) return;
  lastDigestDay = day;

  const [rows] = await db.execute(
    `SELECT
       COUNT(*) AS total,
       SUM(note LIKE '%давно на дв%' OR note LIKE '%на дв %дн%') AS howlong_n,
       SUM(note LIKE '%молчит%') AS silent_n,
       SUM(note LIKE '%вручную%' OR note IS NULL OR note = '') AS manual_n
     FROM operator_lead_flags
     WHERE funnel_stage = 'filtered'
       AND updated_at >= (NOW() - INTERVAL 1 DAY)`,
  );
  const r = rows[0] || {};
  const total = Number(r.total) || 0;
  if (!total) {
    console.log('[opsQuality] Дайджест отсева: за сутки 0');
    return;
  }
  const text =
    `<b>Отсев за сутки</b>\n` +
    `Всего: <b>${total}</b>\n` +
    `· давно на дв: ${Number(r.howlong_n) || 0}\n` +
    `· молчит: ${Number(r.silent_n) || 0}\n` +
    `· вручную/прочее: ${Number(r.manual_n) || 0}`;
  const { sendAdminAlert } = require('./helpRequestNotifier');
  await sendAdminAlert(text);
  console.log('[opsQuality] Дайджест отсева отправлен:', total);
}

async function runAiSilenceWatch({ olderMin = 28, newerMin = 6 } = {}) {
  // newerMin≥6 / olderMin≥28: пауза «Занята» = 5–25 мин — не орём ложный «AI замолчал».
  // Кандидаты по недавним user — без полного GROUP BY + без INTERVAL ? (ломает prepared).
  const older = Math.max(
    1,
    Math.min(24 * 60, Math.max(Number(olderMin) || 28, (Number(newerMin) || 6) + 5)),
  );
  const newer = Math.max(1, Math.min(120, Number(newerMin) || 6));
  const [rows] = await db.query(
    `SELECT c.account_id, c.peer_id,
            (SELECT MAX(cm.peer_username) FROM conversation_messages cm
              WHERE cm.account_id = c.account_id AND cm.peer_id = c.peer_id
                AND cm.created_at >= (NOW() - INTERVAL ${older} MINUTE)) AS peer_username,
            c.last_user_at,
            (SELECT MAX(b.created_at) FROM conversation_messages b
              WHERE b.account_id = c.account_id AND b.peer_id = c.peer_id
                AND b.role = 'assistant') AS last_bot_at
     FROM (
       SELECT account_id, peer_id, MAX(created_at) AS last_user_at
       FROM conversation_messages
       WHERE role = 'user'
         AND created_at >= (NOW() - INTERVAL ${older} MINUTE)
         AND created_at <= (NOW() - INTERVAL ${newer} MINUTE)
       GROUP BY account_id, peer_id
     ) c
     JOIN accounts a ON a.id = c.account_id AND a.is_autoreply_enabled = 1
     LEFT JOIN autoreply_disabled_peers ad
       ON ad.account_id = c.account_id AND ad.peer_id = c.peer_id
     LEFT JOIN archived_peers ap
       ON ap.account_id = c.account_id AND ap.peer_id = c.peer_id
     LEFT JOIN operator_lead_flags olf
       ON olf.account_id = c.account_id AND olf.peer_id = c.peer_id
     WHERE ap.peer_id IS NULL
       AND ad.id IS NULL
       AND (olf.funnel_stage IS NULL OR olf.funnel_stage <> 'filtered')
       AND NOT EXISTS (
         SELECT 1 FROM conversation_messages b
         WHERE b.account_id = c.account_id AND b.peer_id = c.peer_id
           AND b.role = 'assistant' AND b.created_at >= c.last_user_at
       )
     ORDER BY c.last_user_at ASC
     LIMIT 25`,
  );

  if (!rows.length) return;

  // Не алертить, если уже идёт «Занята» / буфер / in-flight ответ.
  const skipKeys = new Set();
  try {
    const inbound = require('./inbound');
    for (const map of [
      inbound.deferredDialogs,
      inbound.messageBuffers,
      inbound.gapRetries,
    ]) {
      if (map && typeof map.keys === 'function') {
        for (const k of map.keys()) skipKeys.add(String(k));
      }
    }
    if (inbound.processingInFlight && typeof inbound.processingInFlight.values === 'function') {
      for (const k of inbound.processingInFlight) skipKeys.add(String(k));
    }
  } catch (_) {
    /* inbound optional at boot */
  }

  const { getActiveClient } = require('./telegramClient');
  const stuck = [];
  const now = Date.now();
  for (const row of rows) {
    if (!getActiveClient(row.account_id)) continue;
    const key = `${row.account_id}:${row.peer_id}`;
    if (skipKeys.has(key)) continue;
    const prev = silenceAlerted.get(key) || 0;
    if (now - prev < 45 * 60 * 1000) continue;
    silenceAlerted.set(key, now);
    const ageMin = Math.round((now - new Date(row.last_user_at).getTime()) / 60000);
    stuck.push(
      `#${row.account_id} ${row.peer_username || row.peer_id} · ${ageMin}м без ответа`,
    );
  }
  if (!stuck.length) return;

  const { sendAdminAlert } = require('./helpRequestNotifier');
  const text =
    `<b>AI замолчал</b>\n` +
    `Живые аккаунты, человек ждёт ответ:\n` +
    stuck.slice(0, 12).map((l) => `· ${l}`).join('\n');
  await sendAdminAlert(text);
  console.log('[opsQuality] AI silence alert:', stuck.length);
}

let lastWaitingPushAt = 0;

/** ≥3 живых лида ждут ответа >10 мин → пуш админу/операторам. */
async function runWaitingLeadsWatch() {
  const now = Date.now();
  if (now - lastWaitingPushAt < 20 * 60 * 1000) return;
  // Ночь / вне глобального дня — не орём: heal и так догоняет или ждёт утра.
  try {
    const timing = require('./timing');
    if (typeof timing.isNightTextQuietHour === 'function' && timing.isNightTextQuietHour()) {
      return;
    }
    if (
      typeof timing.isWithinGlobalWorkingHours === 'function' &&
      !timing.isWithinGlobalWorkingHours()
    ) {
      return;
    }
  } catch (_) {
    /* optional */
  }
  // Как silence gaps: без архива / disabled / filtered; только «живые» реплики
  // (не «пока» / «бери трубку» — там ИИ не должен писать).
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM (
       SELECT c.account_id, c.peer_id,
              (SELECT LEFT(u.content, 120) FROM conversation_messages u
                WHERE u.account_id = c.account_id AND u.peer_id = c.peer_id
                  AND u.role = 'user'
                ORDER BY u.id DESC LIMIT 1) AS last_user_text
       FROM (
         SELECT account_id, peer_id, MAX(created_at) AS last_user_at
         FROM conversation_messages
         WHERE role = 'user'
           AND created_at >= (NOW() - INTERVAL 6 HOUR)
           AND created_at <= (NOW() - INTERVAL 10 MINUTE)
         GROUP BY account_id, peer_id
       ) c
       JOIN accounts a ON a.id = c.account_id AND a.is_autoreply_enabled = 1
       LEFT JOIN autoreply_disabled_peers ad
         ON ad.account_id = c.account_id AND ad.peer_id = c.peer_id
       LEFT JOIN archived_peers ap
         ON ap.account_id = c.account_id AND ap.peer_id = c.peer_id
       LEFT JOIN operator_lead_flags olf
         ON olf.account_id = c.account_id AND olf.peer_id = c.peer_id
       WHERE ap.peer_id IS NULL
         AND ad.id IS NULL
         AND (olf.funnel_stage IS NULL OR olf.funnel_stage NOT IN ('filtered','operator'))
         AND NOT EXISTS (
           SELECT 1 FROM conversation_messages b
           WHERE b.account_id = c.account_id AND b.peer_id = c.peer_id
             AND b.role = 'assistant' AND b.created_at >= c.last_user_at
         )
     ) t
     WHERE TRIM(IFNULL(t.last_user_text, '')) <> ''
       AND TRIM(t.last_user_text) NOT REGEXP '^[.!?…]+$'
       AND TRIM(t.last_user_text) NOT REGEXP '^(понятно|понял|ок|окей|ладно|угу|ага|ясно|ну[[:space:]]+ок)([.!?…)]|[[:space:]])*$'
       AND t.last_user_text NOT REGEXP '(ты[[:space:]]+(бот|ии|нейро)|привет[,.[:space:]]*ии|боты?[[:space:]]+заеб|это[[:space:]]+бот)'
       AND t.last_user_text NOT REGEXP '^(бери[[:space:]]+трубку|подними[[:space:]]+трубку|возьми[[:space:]]+трубку|позвони|набери|дай[[:space:]]+номер|скинь[[:space:]]+номер)'
       AND t.last_user_text NOT REGEXP '(^|[[:space:][:punct:]]+)(пока|ппк)([.!?…)]|[[:space:]])*$'
       AND t.last_user_text NOT REGEXP '^(спокойной([[:space:]]+ноч(и|ки))?|сладких[[:space:]]+снов|доброй[[:space:]]+ноч(и|ки)|до[[:space:]]+завтра|я[[:space:]]+(иду[[:space:]]+)?спать|пойду[[:space:]]+спать|бай|bb)([.!?…)]|[[:space:]💕❤️✨])*$'`,
  );
  const n = Number(rows?.[0]?.c || 0);
  if (n < 3) return;
  lastWaitingPushAt = now;
  const { sendAdminAlert } = require('./helpRequestNotifier');
  await sendAdminAlert(`<b>Ждут ответа</b>\n${n} диалогов без ответа &gt;10 мин`);
  console.log('[opsQuality] waiting leads push:', n);
}

/** day4 escalate push — выключен (шум: почти всегда уже после nft.ogg). */
async function runDay4EscalateWatch() {
  return;
}

async function runProxyAliveWatch() {
  let pools;
  try {
    pools = require('./scaleOps').getPoolRoleCounts();
  } catch (_) {
    pools = null;
  }
  const pl = process.env.PROXY_LIST || '';
  const n = pl.split(';').filter((x) => x.trim()).length;
  let poolLen = n;
  try {
    const { PROXY_POOL } = require('./proxyPools');
    poolLen = Math.max(poolLen, (PROXY_POOL && PROXY_POOL.length) || 0);
  } catch (_) {
    /* optional */
  }
  if (pools) poolLen = Math.max(poolLen, pools.work);

  const workLow = poolLen < MIN_PROXY_LEN;
  const loginLow = pools && !pools.loginOk;
  if (!workLow && !loginLow) return;

  const now = Date.now();
  if (now - lastProxyAlertAt < 20 * 60 * 1000) return;
  lastProxyAlertAt = now;

  const lines = [];
  if (workLow) {
    lines.push(`Work PROXY: ${poolLen} (нужно ≥${MIN_PROXY_LEN})`);
    console.error(`[opsQuality] PROXY_WATCH work: len=${poolLen} < ${MIN_PROXY_LEN}`);
  }
  if (loginLow) {
    lines.push(`Login residential: ${pools.login} (нужно ≥${pools.loginMin})`);
    console.error(`[opsQuality] PROXY_WATCH login: len=${pools.login} < ${pools.loginMin}`);
  }
  try {
    const { sendAdminAlert } = require('./helpRequestNotifier');
    await sendAdminAlert(`<b>Прокси по ролям</b>\n` + lines.map((l) => `· ${l}`).join('\n'));
  } catch (_) {
    /* optional */
  }
  if (workLow) {
    try {
      const { spawn } = require('child_process');
      const script =
        '/root/opt/tgbot/tg-miniapp-loverussian/backend/scripts/_force_alive_proxy_pm2.sh';
      const fs = require('fs');
      if (fs.existsSync(script)) {
        spawn('bash', [script], { detached: true, stdio: 'ignore' }).unref();
        console.warn('[opsQuality] PROXY_WATCH: запустил force_alive');
      }
    } catch (e) {
      console.warn('[opsQuality] PROXY_WATCH restore:', e.message);
    }
  }
}

async function runSessionCountWatch() {
  let online = 0;
  try {
    online = require('./clientPool').getActiveClientCount();
  } catch (_) {
    return;
  }
  if (online >= MIN_ACTIVE_SESSIONS) return;
  const now = Date.now();
  if (now - lastSessionAlertAt < 30 * 60 * 1000) return;
  // После рестарта даём прогреться ~3м
  if (process.uptime && process.uptime() < 180) return;
  lastSessionAlertAt = now;
  console.error(`[opsQuality] SESSION_WATCH: online=${online} < ${MIN_ACTIVE_SESSIONS}`);
  try {
    const { sendAdminAlert } = require('./helpRequestNotifier');
    await sendAdminAlert(
      `<b>Мало сессий</b>\nОнлайн GramJS: <b>${online}</b> (ожидали ≥${MIN_ACTIVE_SESSIONS}).`,
    );
  } catch (_) {
    /* optional */
  }
}

/** Stuck: «по работе» ушло, nft.ogg нет >90м. */
async function runNftFunnelWatch() {
  try {
    const metrics = await require('./opsLiveMetrics').getLiveMetrics();
    const stuck = Number(metrics?.nftFunnel?.stuckWorkNoVoice || 0);
    const voice7d = Number(metrics?.nftFunnel?.voice7d || 0);
    if (stuck < 3) return;
    const now = Date.now();
    if (now - lastNftStuckAlertAt < 45 * 60 * 1000) return;
    lastNftStuckAlertAt = now;
    console.warn(`[opsQuality] NFT_FUNNEL stuckWorkNoVoice=${stuck} voice7d=${voice7d}`);
    try {
      const { sendAdminAlert } = require('./helpRequestNotifier');
      await sendAdminAlert(
        `<b>NFT воронка</b>\n«По работе» без ГС: <b>${stuck}</b>\nГС за 7д: ${voice7d}`,
      );
    } catch (_) {
      /* optional */
    }
  } catch (e) {
    console.error('[opsQuality] nft-funnel:', e.message);
  }
}

/** Тихий пуш: OpenAI / AUDIT_SMOKE / пул прокси для ИИ. */
async function runOpenAiReadyWatch() {
  let ready = false;
  let proxyLen = 0;
  try {
    const ai = require('./aiResponder');
    ready = typeof ai.isOpenAiClientReady === 'function' ? Boolean(ai.isOpenAiClientReady()) : false;
    proxyLen = typeof ai.openAiProxyPoolLen === 'function' ? Number(ai.openAiProxyPoolLen()) || 0 : 0;
  } catch (_) {
    ready = false;
  }
  const auditSmoke = process.env.AUDIT_SMOKE === '1';
  const ok = ready && !auditSmoke;
  const now = Date.now();
  if (ok) {
    if (!lastOpenAiOk) {
      lastOpenAiOk = true;
      try {
        const { sendAdminAlert } = require('./helpRequestNotifier');
        await sendAdminAlert('<b>OpenAI снова ок</b>\nКлиент живой, ответы должны идти.');
      } catch (_) {
        /* optional */
      }
    }
    return;
  }
  lastOpenAiOk = false;
  if (now - lastOpenAiAlertAt < 20 * 60 * 1000) return;
  lastOpenAiAlertAt = now;
  const why = [];
  if (auditSmoke) why.push('AUDIT_SMOKE=1');
  if (!ready) why.push('openai клиент null');
  if (proxyLen < 1) why.push(`openai proxy=${proxyLen}`);
  console.error('[opsQuality] OPENAI_WATCH:', why.join(', '));
  try {
    const { sendAdminAlert } = require('./helpRequestNotifier');
    await sendAdminAlert(
      `<b>OpenAI упал</b>\n` + why.map((l) => `· ${l}`).join('\n'),
    );
  } catch (_) {
    /* optional */
  }
}

/** Тихий пуш: AI вкл + есть session, но живого клиента нет (после прогрева). */
async function runAccountOfflineWatch() {
  // Волны bootstrap + reconnect — не орём первые 10 минут.
  if (process.uptime && process.uptime() < 600) return;
  try {
    const timing = require('./timing');
    if (typeof timing.isNightTextQuietHour === 'function' && timing.isNightTextQuietHour()) {
      return;
    }
  } catch (_) {
    /* optional */
  }
  const now = Date.now();
  if (now - lastOfflineAlertAt < 45 * 60 * 1000) return;
  let rows = [];
  try {
    const [list] = await db.execute(
      `SELECT a.id, a.phone, a.seq
       FROM accounts a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.is_autoreply_enabled = 1
         AND COALESCE(u.is_blocked, 0) = 0
         AND a.session_string IS NOT NULL
         AND CHAR_LENGTH(a.session_string) > 40
       ORDER BY a.id
       LIMIT 200`,
    );
    rows = list || [];
  } catch (e) {
    console.error('[opsQuality] offline-watch query:', e.message);
    return;
  }
  let isActiveFn = () => false;
  try {
    isActiveFn = require('./telegramClient').isActive;
  } catch (_) {
    return;
  }
  const offline = [];
  for (const r of rows) {
    try {
      if (!isActiveFn(r.id)) offline.push(r);
    } catch (_) {
      offline.push(r);
    }
  }
  // Шум: 1–2 отвала — ок; орём от 4+ или ≥35% пула с сессией.
  const n = offline.length;
  const total = rows.length || 1;
  if (n < 4 && n / total < 0.35) return;
  lastOfflineAlertAt = now;
  const sample = offline
    .slice(0, 8)
    .map((r) => `#${r.id}${r.seq != null ? ` (seq ${r.seq})` : ''}`)
    .join(', ');
  console.warn(`[opsQuality] OFFLINE_WATCH aiOn_offline=${n}/${total}`);
  try {
    const { sendAdminAlert } = require('./helpRequestNotifier');
    await sendAdminAlert(
      `<b>Аккаунты офлайн</b>\nAI вкл, сессии нет: <b>${n}</b> из ${total}\n${sample}`,
    );
  } catch (_) {
    /* optional */
  }
}

/** AUTH_KEY_DUPLICATED — список акков из noteAuthKeyDuplicated. */
async function runAuthKeyWatch() {
  const now = Date.now();
  const recent = [...authKeyHits.entries()].filter(([, ts]) => now - ts < 60 * 60 * 1000);
  if (recent.length < 2) return;
  if (now - lastAuthKeyAlertAt < 45 * 60 * 1000) return;
  lastAuthKeyAlertAt = now;
  const ids = recent.map(([id]) => id).sort((a, b) => a - b);
  console.error(`[opsQuality] AUTH_KEY_WATCH accounts=${ids.join(',')}`);
  try {
    const { sendAdminAlert } = require('./helpRequestNotifier');
    await sendAdminAlert(
      `<b>AUTH_KEY</b>\nНужен релогин: <b>${ids.join(', ')}</b>`,
    );
  } catch (_) {
    /* optional */
  }
}

let authKeyHooked = false;
function startOpsQualitySchedulers() {
  if (!authKeyHooked) {
    authKeyHooked = true;
    try {
      require('./opsEvents').on('authKeyDuplicated', (accountId) => {
        noteAuthKeyDuplicated(accountId);
      });
    } catch (_) {
      /* optional */
    }
  }
  if (!digestTimer) {
    digestTimer = setInterval(() => {
      runFilteredDigest().catch((e) =>
        console.error('[opsQuality] digest:', e.message),
      );
    }, 15 * 60 * 1000);
  }
  if (!silenceTimer) {
    silenceTimer = setInterval(() => {
      runAiSilenceWatch().catch((e) =>
        console.error('[opsQuality] silence:', e.message),
      );
      runWaitingLeadsWatch().catch((e) =>
        console.error('[opsQuality] waiting:', e.message),
      );
      try {
        require('./silenceCatchup')
          .runSilenceCatchupHeal({ limit: 12 })
          .catch((e) => console.error('[opsQuality] silence-heal:', e.message));
      } catch (e) {
        console.error('[opsQuality] silence-heal:', e.message);
      }
    }, 5 * 60 * 1000);
    // первый проход через минуту после старта
    setTimeout(() => {
      runAiSilenceWatch().catch(() => {});
      try {
        require('./silenceCatchup')
          .runSilenceCatchupHeal({ limit: 12 })
          .catch(() => {});
      } catch (_) {
        /* optional */
      }
    }, 90 * 1000);
  }
  if (!proxyWatchTimer) {
    proxyWatchTimer = setInterval(() => {
      runProxyAliveWatch().catch((e) =>
        console.error('[opsQuality] proxy-watch:', e.message),
      );
    }, 5 * 60 * 1000);
    setTimeout(() => {
      runProxyAliveWatch().catch(() => {});
    }, 90 * 1000);
  }
  if (!sessionWatchTimer) {
    sessionWatchTimer = setInterval(() => {
      runSessionCountWatch().catch((e) =>
        console.error('[opsQuality] session-watch:', e.message),
      );
      runAuthKeyWatch().catch((e) =>
        console.error('[opsQuality] auth-key:', e.message),
      );
    }, 5 * 60 * 1000);
    setTimeout(() => {
      runSessionCountWatch().catch(() => {});
      runAuthKeyWatch().catch(() => {});
    }, 3 * 60 * 1000);
  }
  if (!nftFunnelTimer) {
    nftFunnelTimer = setInterval(() => {
      runNftFunnelWatch().catch((e) =>
        console.error('[opsQuality] nft-funnel:', e.message),
      );
    }, 10 * 60 * 1000);
    setTimeout(() => {
      runNftFunnelWatch().catch(() => {});
    }, 4 * 60 * 1000);
  }
  if (!openaiWatchTimer) {
    openaiWatchTimer = setInterval(() => {
      runOpenAiReadyWatch().catch((e) =>
        console.error('[opsQuality] openai-watch:', e.message),
      );
    }, 5 * 60 * 1000);
    setTimeout(() => {
      runOpenAiReadyWatch().catch(() => {});
    }, 2 * 60 * 1000);
  }
  if (!offlineWatchTimer) {
    offlineWatchTimer = setInterval(() => {
      runAccountOfflineWatch().catch((e) =>
        console.error('[opsQuality] offline-watch:', e.message),
      );
    }, 10 * 60 * 1000);
    setTimeout(() => {
      runAccountOfflineWatch().catch(() => {});
    }, 4 * 60 * 1000);
  }
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      pruneOpsMaps();
      try {
        require('./inbound')
          .flushDueTextPromises()
          .catch((e) => console.error('[opsQuality] text-promise:', e.message));
      } catch (e) {
        console.error('[opsQuality] text-promise:', e.message);
      }
      try {
        require('./inbound')
          .flushDueDeferredMedia()
          .catch((e) => console.error('[opsQuality] deferred-media:', e.message));
      } catch (e) {
        console.error('[opsQuality] deferred-media:', e.message);
      }
    }, 2 * 60 * 1000);
  }
  console.log(
    '[opsQuality] schedulers: digest 15м, silence+heal/proxy/session/auth/openai 5м, nft+offline 10м, text-promise+deferred-media 2м',
  );
}

module.exports = {
  FILTER_REASONS,
  formatFilterNote,
  parseFilterReason,
  tempoForLeadTier,
  applyTempoDelay,
  allowProactiveMedia,
  preferSilentReaction,
  SHORT_ACK_RE,
  mediaTimeSlot,
  mediaSlotPolicy,
  sortMediaBySlotPrefer,
  runFilteredDigest,
  runAiSilenceWatch,
  runWaitingLeadsWatch,
  runDay4EscalateWatch,
  runProxyAliveWatch,
  runSessionCountWatch,
  runNftFunnelWatch,
  runOpenAiReadyWatch,
  runAccountOfflineWatch,
  runAuthKeyWatch,
  noteAuthKeyDuplicated,
  startOpsQualitySchedulers,
};
