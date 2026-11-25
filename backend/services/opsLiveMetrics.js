/**
 * Живые метрики для Electron OPS (только админ).
 * Радар (ответов/час, AI замолчал) и день МСК — из БД.
 * bump/noteReply в памяти — только процессные счётчики / fallback.
 */
const db = require('../db');

const counters = {
  replies: 0,
  busyDefer: 0,
  silenceHeal: 0,
  nearDupSkip: 0,
  trashFilter: 0,
  textPromiseFire: 0,
  nftWorkMention: 0,
  nftVoiceSent: 0,
  nftReschedule: 0,
  startedAt: Date.now(),
};

/** last assistant send: accountId -> ts */
const lastReplyAt = new Map();
/** cliche phrase -> count (day) */
let clicheDay = '';
const clicheCounts = new Map();

const CLICHE_TRACK = [
  'просто общаюсь',
  'не покажу',
  'я обычная',
  'как тебе',
  'ну ок',
  'кайф',
  'ага)',
];

function bump(key, n = 1) {
  if (Object.prototype.hasOwnProperty.call(counters, key) && key !== 'startedAt') {
    counters[key] += n;
  }
}

function noteReply(accountId, text) {
  if (accountId != null) lastReplyAt.set(Number(accountId), Date.now());
  const day = new Date().toISOString().slice(0, 10);
  if (day !== clicheDay) {
    clicheDay = day;
    clicheCounts.clear();
  }
  const low = String(text || '').toLowerCase();
  for (const p of CLICHE_TRACK) {
    if (low.includes(p)) clicheCounts.set(p, (clicheCounts.get(p) || 0) + 1);
  }
}

function sqlMskDayStart() {
  return `DATE_ADD(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR)), INTERVAL -3 HOUR)`;
}

/** Кэш снапшота — админка не должна ждать минуту на каждый открытие. */
let liveMetricsCache = { at: 0, value: null };
const LIVE_METRICS_TTL_MS = Math.max(
  10_000,
  Number(process.env.OPS_LIVE_METRICS_TTL_MS) || 45_000,
);

/**
 * AI «замолчал»: без JOIN всей истории assistant (раньше ~60с).
 * Берём last_user за 2ч + last_assistant за сутки — оба через GROUP BY.
 */
async function queryStaleAiAccounts() {
  const [staleRows] = await db.execute(
    `SELECT a.id AS accountId,
            TIMESTAMPDIFF(MINUTE, la.last_at, NOW()) AS silentMin
     FROM accounts a
     INNER JOIN (
       SELECT account_id, MAX(created_at) AS last_user_at
       FROM conversation_messages
       WHERE role = 'user'
         AND created_at >= (NOW() - INTERVAL 2 HOUR)
       GROUP BY account_id
     ) u ON u.account_id = a.id
     LEFT JOIN (
       SELECT account_id, MAX(created_at) AS last_at
       FROM conversation_messages
       WHERE role = 'assistant'
         AND content NOT LIKE '[реакция:%'
         AND created_at >= (NOW() - INTERVAL 1 DAY)
       GROUP BY account_id
     ) la ON la.account_id = a.id
     WHERE a.is_autoreply_enabled = 1
       AND (la.last_at IS NULL OR la.last_at < (NOW() - INTERVAL 30 MINUTE))
     ORDER BY silentMin DESC
     LIMIT 20`,
  );
  return (staleRows || []).map((r) => ({
    accountId: Number(r.accountId),
    silentMin: Number(r.silentMin != null ? r.silentMin : 999),
  }));
}

async function buildLiveMetrics() {
  const daySql = sqlMskDayStart();
  let dbDay = { sent: 0, incoming: 0, filtered: 0, howlong: 0, silent: 0, trash: 0 };
  let repliesPerHour = 0;
  let staleAi = [];
  let lastGlobalDb = null;
  let nftFunnel = {
    scheduleTotal: 0,
    workPending: 0,
    workSent: 0,
    openWork: 0,
    voice7d: 0,
    stuckWorkNoVoice: 0,
    staleDialog: 0,
    liveDialog90: 0,
  };

  const liveMin = Math.max(1, Number(process.env.NFT_LIVE_DIALOG_MIN) || 90);
  const now = Date.now();

  await Promise.all([
    (async () => {
      try {
        const [[m]] = await db.execute(
          `SELECT
             SUM(role = 'assistant' AND content NOT LIKE '[реакция:%' AND content NOT LIKE '[медиа:%') AS sent,
             SUM(role = 'user') AS incoming
           FROM conversation_messages
           WHERE created_at >= ${daySql}`,
        );
        dbDay.sent = Number(m?.sent || 0);
        dbDay.incoming = Number(m?.incoming || 0);
      } catch (_) {
        /* optional */
      }
    })(),
    (async () => {
      try {
        const [[f]] = await db.execute(
          `SELECT
             COUNT(*) AS filtered,
             SUM(note LIKE '%давно на дв%') AS howlong,
             SUM(note LIKE '%молчит%') AS silent,
             SUM(note LIKE '%мусор%' OR note LIKE '%платят%') AS trash
           FROM operator_lead_flags
           WHERE funnel_stage = 'filtered'`,
        );
        dbDay.filtered = Number(f?.filtered || 0);
        dbDay.howlong = Number(f?.howlong || 0);
        dbDay.silent = Number(f?.silent || 0);
        dbDay.trash = Number(f?.trash || 0);
      } catch (_) {
        /* optional */
      }
    })(),
    (async () => {
      try {
        const [[rh]] = await db.execute(
          `SELECT COUNT(*) AS n FROM conversation_messages
           WHERE role = 'assistant'
             AND content NOT LIKE '[реакция:%'
             AND content NOT LIKE '[медиа:%'
             AND created_at >= (NOW() - INTERVAL 1 HOUR)`,
        );
        repliesPerHour = Number(rh?.n || 0);
      } catch (_) {
        const uptimeMin = Math.max(1, Math.round((now - counters.startedAt) / 60000));
        repliesPerHour = Math.round((counters.replies / uptimeMin) * 60);
      }
    })(),
    (async () => {
      try {
        staleAi = await queryStaleAiAccounts();
      } catch (_) {
        for (const [aid, ts] of lastReplyAt) {
          if (now - ts > 30 * 60 * 1000) {
            staleAi.push({ accountId: aid, silentMin: Math.round((now - ts) / 60000) });
          }
        }
      }
    })(),
    (async () => {
      try {
        const [[lg]] = await db.execute(
          `SELECT UNIX_TIMESTAMP(MAX(created_at)) * 1000 AS ts
           FROM conversation_messages
           WHERE role = 'assistant'
             AND content NOT LIKE '[реакция:%'
             AND created_at >= (NOW() - INTERVAL 1 DAY)`,
        );
        if (lg?.ts != null) lastGlobalDb = Number(lg.ts);
      } catch (_) {
        /* optional */
      }
    })(),
    (async () => {
      try {
        const [[[c]], [[pend]], [[sent]], [[voices]], [[stuck]], [[stale]], [[live90]]] =
          await Promise.all([
            db.execute('SELECT COUNT(*) AS n FROM nft_voice_schedule'),
            db.execute(
              `SELECT COUNT(*) AS n FROM nft_voice_schedule
               WHERE work_mention_sent = 0
                 AND (voice_skip_reason IS NULL OR voice_skip_reason = '')`,
            ),
            db.execute(
              'SELECT COUNT(*) AS n FROM nft_voice_schedule WHERE work_mention_sent = 1',
            ),
            db.execute(
              `SELECT COUNT(*) AS n FROM conversation_messages
               WHERE role='assistant'
                 AND (content LIKE '%[голосовое: nft.ogg]%' OR content LIKE '%nft.ogg%')
                 AND created_at >= NOW() - INTERVAL 7 DAY`,
            ),
            db.execute(
              `SELECT COUNT(*) AS n FROM nft_voice_schedule nvs
               WHERE nvs.work_mention_sent = 1
                 AND (nvs.voice_skip_reason IS NULL OR nvs.voice_skip_reason = '')
                 AND nvs.scheduled_at < (NOW() - INTERVAL 90 MINUTE)
                 AND NOT EXISTS (
                   SELECT 1 FROM conversation_messages cm
                   WHERE cm.account_id = nvs.account_id AND cm.peer_id = nvs.peer_id
                     AND cm.role = 'assistant'
                     AND (cm.content LIKE '%[голосовое: nft.ogg]%' OR cm.content LIKE '%nft.ogg%')
                     AND cm.created_at >= nvs.work_mention_at
                 )`,
            ),
            db.execute(
              `SELECT COUNT(*) AS n FROM nft_voice_schedule WHERE voice_skip_reason = 'stale_dialog'`,
            ),
            db.execute(
              `SELECT COUNT(*) AS n FROM nft_voice_schedule nvs
               WHERE nvs.work_mention_sent = 1
                 AND (nvs.voice_skip_reason IS NULL OR nvs.voice_skip_reason = '')
                 AND EXISTS (
                   SELECT 1 FROM conversation_messages cm
                   WHERE cm.account_id = nvs.account_id AND cm.peer_id = nvs.peer_id
                     AND cm.role = 'user'
                     AND cm.created_at >= (NOW() - INTERVAL ${liveMin} MINUTE)
                 )`,
            ),
          ]);
        nftFunnel = {
          scheduleTotal: Number(c.n || 0),
          workPending: Number(pend.n || 0),
          openWork: Number(pend.n || 0),
          workSent: Number(sent.n || 0),
          voice7d: Number(voices.n || 0),
          stuckWorkNoVoice: Number(stuck.n || 0),
          staleDialog: Number(stale.n || 0),
          liveDialog90: Number(live90.n || 0),
        };
      } catch (_) {
        /* optional */
      }
    })(),
  ]);

  let proxyLen = 0;
  try {
    const pl = String(process.env.PROXY_LIST || '');
    proxyLen = pl.split(';').filter((x) => x.trim()).length;
  } catch (_) {}

  let notifierOk = false;
  try {
    const help = require('./helpRequestNotifier');
    notifierOk = typeof help.startNotificationBot === 'function';
  } catch (_) {}

  const topCliches = [...clicheCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([phrase, count]) => ({ phrase, count }));

  const uptimeMin = Math.round((Date.now() - counters.startedAt) / 60000);
  const lastGlobalMem =
    lastReplyAt.size > 0 ? Math.max(...lastReplyAt.values()) : null;
  const lastGlobal = lastGlobalDb != null ? lastGlobalDb : lastGlobalMem;

  return {
    process: { ...counters, uptimeMin, proxyLen },
    dayMsk: dbDay,
    nftFunnel,
    repliesPerHour,
    health: {
      lastReplyAt: lastGlobal,
      lastReplyAgeMin: lastGlobal != null ? Math.round((now - lastGlobal) / 60000) : null,
      proxyLen,
      notifierOk,
      source: 'db',
    },
    topCliches,
    staleAiAccounts: staleAi.slice(0, 20),
  };
}

async function getLiveMetrics({ force = false } = {}) {
  const now = Date.now();
  if (
    !force &&
    liveMetricsCache.value &&
    now - liveMetricsCache.at < LIVE_METRICS_TTL_MS
  ) {
    return liveMetricsCache.value;
  }
  const value = await buildLiveMetrics();
  liveMetricsCache = { at: Date.now(), value };
  return value;
}

module.exports = {
  bump,
  getLiveMetrics,
  counters,
  noteReply,
  lastReplyAt,
  CLICHE_TRACK,
  queryStaleAiAccounts,
};
