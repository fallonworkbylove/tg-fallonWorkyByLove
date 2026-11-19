/**
 * Lead scoring + воронка для кабинета оператора.
 * Эвристики по истории (без доп. LLM).
 */

const db = require('../db');

/** Колонки доски / чипы миниаппа — дни NFT-кампании. */
const FUNNEL_BOARD_STAGES = ['day1', 'day2', 'day3', 'day4'];
/** Все допустимые этапы (включая отсев для метрик/howlong). */
const FUNNEL_STAGES = [...FUNNEL_BOARD_STAGES, 'filtered'];
const FUNNEL_LABELS = {
  day1: '1 день',
  day2: '2 день',
  day3: '3 день · NFT',
  day4: '4 день · NFT',
  filtered: 'Отсев',
};
const LEGACY_FUNNEL_MAP = {
  hello: 'day1',
  chat: 'day2',
  interest: 'day3',
  pitch: 'day4',
  operator: 'day4',
};
/** Совпадает с nftCampaign.NFT_VOICE_AFTER_HOURS (без циклического require). */
const FUNNEL_VOICE_AFTER_HOURS = 48;
const FUNNEL_DAY4_HOURS = 72;
const READY_STAGES = new Set(['day3', 'day4']);

function normalizeFunnelStage(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (FUNNEL_STAGES.includes(s)) return s;
  if (LEGACY_FUNNEL_MAP[s]) return LEGACY_FUNNEL_MAP[s];
  return null;
}

function dayStageFromAge(ageHours, nftVoice) {
  const age = Number(ageHours);
  const h = Number.isFinite(age) && age >= 0 ? age : 0;
  if (nftVoice || h >= FUNNEL_DAY4_HOURS) return 'day4';
  if (h >= FUNNEL_VOICE_AFTER_HOURS) return 'day3';
  if (h >= 24) return 'day2';
  return 'day1';
}

/** Срез служебных ярлыков цитаты с карточки OPS / миниаппа. */
function cleanBoardSnippet(text) {
  return String(text || '')
    .replace(
      /\[(?:уточнение к твоей фразе|ответ на(?:\s+его\s+сообщение)?|ответ на твою фразу|Ответ на сообщение(?:\s+собеседника)?)[^\]]*\]:?\s*/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS operator_lead_flags (
      account_id INT NOT NULL,
      peer_id VARCHAR(64) NOT NULL,
      focus TINYINT(1) NOT NULL DEFAULT 0,
      note VARCHAR(255) NULL,
      funnel_stage VARCHAR(16) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (account_id, peer_id),
      INDEX idx_focus (focus, updated_at),
      INDEX idx_funnel (funnel_stage)
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS archived_peers (
      account_id INT NOT NULL,
      peer_id VARCHAR(64) NOT NULL,
      archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (account_id, peer_id)
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cleared_peers (
      account_id INT NOT NULL,
      peer_id VARCHAR(64) NOT NULL,
      cleared_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (account_id, peer_id)
    )
  `);
  // Старые таблицы без колонки funnel_stage.
  try {
    const [cols] = await db.execute(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'operator_lead_flags'
         AND COLUMN_NAME = 'funnel_stage'
       LIMIT 1`,
    );
    if (!cols.length) {
      await db.execute(
        `ALTER TABLE operator_lead_flags ADD COLUMN funnel_stage VARCHAR(16) NULL`,
      );
    }
  } catch (_) {
    /* ignore */
  }
  try {
    const [cols] = await db.execute(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'operator_lead_flags'
         AND COLUMN_NAME = 'digest_sent_at'
       LIMIT 1`,
    );
    if (!cols.length) {
      await db.execute(
        `ALTER TABLE operator_lead_flags ADD COLUMN digest_sent_at TIMESTAMP NULL`,
      );
    }
  } catch (_) {
    /* ignore */
  }
  schemaReady = true;
}

async function markPeerArchived(accountId, peerId) {
  if (!accountId || peerId == null || peerId === '') return;
  await ensureSchema();
  await db.execute(
    `INSERT INTO archived_peers (account_id, peer_id)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE archived_at = CURRENT_TIMESTAMP`,
    [accountId, String(peerId)],
  );
}

async function markPeerUnarchived(accountId, peerId) {
  if (!accountId || peerId == null || peerId === '') return;
  await ensureSchema();
  await db.execute(
    `DELETE FROM archived_peers WHERE account_id = ? AND peer_id = ?`,
    [accountId, String(peerId)],
  );
}

async function markPeerCleared(accountId, peerId) {
  if (!accountId || peerId == null || peerId === '') return;
  await ensureSchema();
  const peer = String(peerId);
  await db.execute(
    `INSERT INTO cleared_peers (account_id, peer_id)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE cleared_at = CURRENT_TIMESTAMP`,
    [accountId, peer],
  );
  await db.execute(
    `DELETE FROM operator_lead_flags WHERE account_id = ? AND peer_id = ?`,
    [accountId, peer],
  ).catch(() => {});
  await db.execute(
    `DELETE FROM autoreply_disabled_peers WHERE account_id = ? AND peer_id = ?`,
    [accountId, peer],
  ).catch(() => {});
}

async function unmarkPeerCleared(accountId, peerId) {
  if (!accountId || peerId == null || peerId === '') return;
  await ensureSchema();
  await db.execute(
    `DELETE FROM cleared_peers WHERE account_id = ? AND peer_id = ?`,
    [accountId, String(peerId)],
  );
}

async function isPeerCleared(accountId, peerId) {
  if (!accountId || peerId == null || peerId === '') return false;
  await ensureSchema();
  const [[row]] = await db.execute(
    `SELECT 1 AS ok FROM cleared_peers WHERE account_id = ? AND peer_id = ? LIMIT 1`,
    [accountId, String(peerId)],
  );
  return Boolean(row);
}

/**
 * Стереть историю в кабинете: сообщения + флаги воронки, чтобы
 * catch-up не вернул чат в «Предложку» по старому nft.ogg.
 */
async function clearPeerConversation(accountId, peerId) {
  if (!accountId || peerId == null || peerId === '') return false;
  await ensureSchema();
  const peer = String(peerId);
  await db.execute(
    `DELETE FROM conversation_messages WHERE account_id = ? AND peer_id = ?`,
    [accountId, peer],
  );
  await markPeerCleared(accountId, peer);
  return true;
}

/** Синхронизация снимка архива Telegram → БД (для «Лидов»). */
async function syncArchiveFlags(accountId, flags) {
  if (!accountId || !flags || typeof flags.forEach !== 'function') return;
  await ensureSchema();
  const archived = [];
  const open = [];
  flags.forEach((isArchived, peerId) => {
    if (isArchived) archived.push(String(peerId));
    else open.push(String(peerId));
  });
  for (const peerId of archived) {
    await markPeerArchived(accountId, peerId);
  }
  for (const peerId of open) {
    await markPeerUnarchived(accountId, peerId);
  }
}

const archiveSyncAt = new Map();

/** Раз в ~90с подтягиваем архив с живых клиентов пользователя. */
async function refreshArchivesForUser(userId) {
  const now = Date.now();
  if (now - (archiveSyncAt.get(userId) || 0) < 90_000) return;
  archiveSyncAt.set(userId, now);
  try {
    const tg = require('./telegramClient');
    const [accounts] = await db.execute(
      `SELECT id FROM accounts WHERE user_id = ?`,
      [userId],
    );
    for (const row of accounts) {
      if (!tg.isActive(row.id)) continue;
      const client = tg.getActiveClient(row.id);
      if (!client) continue;
      try {
        const flags = await tg.loadArchiveFlags(client);
        await syncArchiveFlags(row.id, flags);
      } catch (_) {
        /* сеть / flood — список лидов всё равно отфильтруем по БД */
      }
    }
  } catch (_) {
    /* ignore */
  }
}

/** Темы с высоким потенциалом (работа / деньги / NFT / интерес к ней). */
const HOT_SQL =
  "content REGEXP 'работ|зарплат|деньг|доход|заработ|nft|нфт|токен|флип|крипт|инвест|как начать|как вход|расскажи про|интересно про|скинь фото|покажи|кружок|голосовое|встрет|увидел|кофе'";

/** Холод / конфликт — понижаем. */
const COLD_SQL =
  "content REGEXP 'ты бот|фейк|мошен|скам|обман|отстан|пош[её]л|иди нах|не пиши|отпишись|не интерес'";

/**
 * Считает score 0–100 по агрегатам диалога.
 */
function scoreConversation(row) {
  const msgs = Number(row.message_count || 0);
  const userMsgs = Number(row.user_msgs || 0);
  const botMsgs = Number(row.bot_msgs || 0);
  const hotHits = Number(row.hot_hits || 0);
  const coldHits = Number(row.cold_hits || 0);
  const lastAt = row.last_at ? new Date(row.last_at).getTime() : 0;
  const hoursAgo = lastAt ? (Date.now() - lastAt) / 36e5 : 999;

  let score = 0;

  score += Math.min(22, msgs * 1.2);
  if (userMsgs >= 3 && userMsgs >= botMsgs * 0.6) score += 12;
  else if (userMsgs >= 2) score += 6;
  if (hoursAgo <= 1) score += 18;
  else if (hoursAgo <= 6) score += 14;
  else if (hoursAgo <= 24) score += 8;
  else if (hoursAgo <= 72) score += 3;
  else if (hoursAgo > 168) score -= 18;
  else score -= 8;
  score += Math.min(28, hotHits * 7);
  score -= Math.min(30, coldHits * 10);
  if (Number(row.operator_focus) === 1) score += 8;
  if (Number(row.autoreply_disabled) === 1) score += 4;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let tier = 'cold';
  if (score >= 70) tier = 'hot';
  else if (score >= 45) tier = 'warm';

  return { score, tier };
}

/**
 * Авто-этап воронки по дням кампании. Ручной funnel_stage важнее.
 * day1 <24ч → day2 <48ч → day3 NFT (ждём/шлём голос) → day4 NFT (голос ушёл / ≥72ч).
 */
function detectFunnelStage(row, _score) {
  const manualRaw = String(row.funnel_stage_manual || '').trim();
  const manual = normalizeFunnelStage(manualRaw);
  if (manual) return { stage: manual, auto: false };

  const pauseReason = String(row.pause_reason || '');
  if (pauseReason === 'filtered' || manualRaw === 'filtered') {
    return { stage: 'filtered', auto: true };
  }

  const nftVoice =
    Number(row.nft_voice_sent || 0) > 0 || pauseReason === 'nft_voice_sent';
  return {
    stage: dayStageFromAge(row.age_hours, nftVoice),
    auto: true,
  };
}

function funnelOrder(stage) {
  if (stage === 'filtered') return -1;
  const i = FUNNEL_BOARD_STAGES.indexOf(stage);
  return i < 0 ? 0 : i;
}

/**
 * Список диалогов с lead_score и funnel_stage.
 * sort: 'score' | 'recent' | 'funnel'
 * stage: day1|day2|day3|day4|filtered|null
 */
async function listScoredConversations(
  userId,
  { sort = 'score', hotOnly = false, stage = null, limit = 200 } = {},
) {
  await ensureSchema();
  // Подтянуть актуальный архив с Telegram (оператор мог убрать вручную).
  await refreshArchivesForUser(userId);
  const lim = Math.min(500, Math.max(1, Number(limit) || 200));

  const [rows] = await db.execute(
    `SELECT cm.account_id,
            cm.peer_id,
            MAX(cm.peer_username) AS peer_username,
            COUNT(*) AS message_count,
            SUM(cm.role = 'user') AS user_msgs,
            SUM(cm.role = 'assistant') AS bot_msgs,
            MAX(cm.created_at) AS last_at,
            MAX(CASE WHEN cm.role = 'user' THEN cm.created_at END) AS last_user_at,
            TIMESTAMPDIFF(HOUR, MIN(cm.created_at), NOW()) AS age_hours,
            SUM(cm.role = 'user' AND (${HOT_SQL})) AS hot_hits,
            SUM(cm.role = 'user' AND (${COLD_SQL})) AS cold_hits,
            SUM(cm.role = 'assistant' AND cm.content LIKE '%nft.ogg%') AS nft_voice_sent,
            MAX(a.phone) AS account_phone,
            MAX(a.prompt) AS account_prompt,
            MAX(CASE WHEN ad.id IS NULL THEN 0 ELSE 1 END) AS autoreply_disabled,
            MAX(ad.reason) AS pause_reason,
            MAX(CASE WHEN olf.focus = 1 THEN 1 ELSE 0 END) AS operator_focus,
            MAX(olf.note) AS operator_note,
            MAX(olf.funnel_stage) AS funnel_stage_manual
     FROM conversation_messages cm
     JOIN accounts a ON a.id = cm.account_id
     LEFT JOIN autoreply_disabled_peers ad
       ON ad.account_id = cm.account_id AND ad.peer_id = cm.peer_id
     LEFT JOIN operator_lead_flags olf
       ON olf.account_id = cm.account_id AND olf.peer_id = cm.peer_id
     LEFT JOIN archived_peers ap
       ON ap.account_id = cm.account_id AND ap.peer_id = cm.peer_id
     LEFT JOIN cleared_peers cp
       ON cp.account_id = cm.account_id AND cp.peer_id = cm.peer_id
     WHERE a.user_id = ?
       AND cp.peer_id IS NULL
       AND (
         ap.peer_id IS NULL
         OR olf.funnel_stage = 'filtered'
         OR ad.reason = 'filtered'
       )
     GROUP BY cm.account_id, cm.peer_id
     HAVING (
       -- В фокусе оператора — всегда видно
       MAX(CASE WHEN olf.focus = 1 THEN 1 ELSE 0 END) = 1
       -- Живые чаты за сутки
       OR MAX(CASE WHEN cm.role = 'user' THEN cm.created_at END) >= (NOW() - INTERVAL 24 HOUR)
       -- Отсев (в т.ч. после howlong-архива) — до 14 дней
       OR (
         (
           MAX(olf.funnel_stage) = 'filtered'
           OR MAX(ad.reason) = 'filtered'
         )
         AND MAX(CASE WHEN cm.role = 'user' THEN cm.created_at END)
           >= (NOW() - INTERVAL 14 DAY)
       )
       -- День 3–4 NFT / оператор — только пока свежие (не вечный хвост)
       OR (
         (
           MAX(olf.funnel_stage) IN ('day3', 'day4', 'pitch', 'operator', 'interest')
           OR MAX(ad.reason) IN ('nft_voice_sent', 'operator_pause')
         )
         AND MAX(CASE WHEN cm.role = 'user' THEN cm.created_at END)
           >= (NOW() - INTERVAL 48 HOUR)
       )
     )
     ORDER BY last_user_at DESC
     LIMIT ${lim}`,
    [userId],
  );

  let getAccountUsernameSync = () => '';
  let accountDisplayName = () => '';
  let nameFromPrompt = () => '';
  try {
    ({ getAccountUsernameSync, accountDisplayName } = require('./clientPool'));
  } catch (_) { /* optional live cache */ }
  try {
    ({ nameFromPrompt } = require('./adminConsoleStats'));
  } catch (_) { /* optional */ }

  let list = rows.map((row) => {
    const { score, tier } = scoreConversation(row);
    const funnel = detectFunnelStage(row, score);
    let accountUsername = '';
    try {
      accountUsername = String(getAccountUsernameSync(row.account_id) || '').replace(/^@+/, '');
    } catch (_) {
      accountUsername = '';
    }
    let liveName = '';
    try {
      liveName = String(accountDisplayName(row.account_id) || '').trim();
    } catch (_) {
      liveName = '';
    }
    const promptName = String(nameFromPrompt(row.account_prompt) || '').trim();
    const unameLabel = accountUsername ? `@${accountUsername}` : '';
    const accountName = liveName || promptName || unameLabel || null;
    return {
      account_id: row.account_id,
      peer_id: row.peer_id,
      peer_username: row.peer_username,
      message_count: Number(row.message_count || 0),
      user_msgs: Number(row.user_msgs || 0),
      bot_msgs: Number(row.bot_msgs || 0),
      last_at: row.last_at,
      last_user_at: row.last_user_at,
      account_phone: row.account_phone,
      account_name: accountName,
      account_username: accountUsername || null,
      autoreply_disabled: Number(row.autoreply_disabled) === 1,
      pause_reason: row.pause_reason || null,
      operator_focus: Number(row.operator_focus) === 1,
      operator_note: row.operator_note || null,
      hot_hits: Number(row.hot_hits || 0),
      cold_hits: Number(row.cold_hits || 0),
      nft_voice_sent: Number(row.nft_voice_sent || 0) > 0,
      age_hours: Number(row.age_hours || 0),
      lead_score: score,
      lead_tier: tier,
      funnel_stage: funnel.stage,
      funnel_auto: funnel.auto,
      funnel_label: FUNNEL_LABELS[funnel.stage] || funnel.stage,
    };
  });

  const funnelCounts = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0]));
  for (const c of list) {
    if (funnelCounts[c.funnel_stage] != null) funnelCounts[c.funnel_stage] += 1;
  }

  if (hotOnly) {
    list = list.filter((c) => c.lead_score >= 45 || c.operator_focus);
  }

  if (stage && FUNNEL_STAGES.includes(stage)) {
    list = list.filter((c) => c.funnel_stage === stage);
  }

  if (sort === 'funnel') {
    list.sort((a, b) => {
      const fo = funnelOrder(b.funnel_stage) - funnelOrder(a.funnel_stage);
      if (fo) return fo;
      if (b.lead_score !== a.lead_score) return b.lead_score - a.lead_score;
      return new Date(b.last_at) - new Date(a.last_at);
    });
  } else if (sort === 'score') {
    list.sort((a, b) => {
      if (b.operator_focus !== a.operator_focus) return b.operator_focus - a.operator_focus;
      if (b.lead_score !== a.lead_score) return b.lead_score - a.lead_score;
      return new Date(b.last_at) - new Date(a.last_at);
    });
  } else {
    list.sort((a, b) => new Date(b.last_at) - new Date(a.last_at));
  }

  return {
    conversations: list,
    funnel: funnelCounts,
    stages: FUNNEL_BOARD_STAGES,
    labels: FUNNEL_LABELS,
  };
}

/**
 * Глобальная воронка для админ-десктопа (все воркеры, без blocked).
 */
async function listGlobalScoredConversations({ limit = 400 } = {}) {
  await ensureSchema();
  const lim = Math.min(600, Math.max(1, Number(limit) || 400));

  const [rows] = await db.execute(
    `SELECT cm.account_id,
            cm.peer_id,
            MAX(cm.peer_username) AS peer_username,
            COUNT(*) AS message_count,
            SUM(cm.role = 'user') AS user_msgs,
            SUM(cm.role = 'assistant') AS bot_msgs,
            MAX(cm.created_at) AS last_at,
            MAX(CASE WHEN cm.role = 'user' THEN cm.created_at END) AS last_user_at,
            TIMESTAMPDIFF(HOUR, MIN(cm.created_at), NOW()) AS age_hours,
            SUM(cm.role = 'user' AND (${HOT_SQL})) AS hot_hits,
            SUM(cm.role = 'user' AND (${COLD_SQL})) AS cold_hits,
            SUM(cm.role = 'assistant' AND cm.content LIKE '%nft.ogg%') AS nft_voice_sent,
            MAX(a.phone) AS account_phone,
            MAX(u.username) AS worker_username,
            MAX(CASE WHEN ad.id IS NULL THEN 0 ELSE 1 END) AS autoreply_disabled,
            MAX(ad.reason) AS pause_reason,
            MAX(CASE WHEN olf.focus = 1 THEN 1 ELSE 0 END) AS operator_focus,
            MAX(olf.note) AS operator_note,
            MAX(olf.funnel_stage) AS funnel_stage_manual,
            SUBSTRING_INDEX(
              GROUP_CONCAT(
                CASE WHEN cm.role = 'user' THEN LEFT(REPLACE(cm.content, '|', '/'), 100) END
                ORDER BY cm.created_at DESC
                SEPARATOR '|'
              ),
              '|',
              1
            ) AS last_user_text
     FROM conversation_messages cm
     JOIN accounts a ON a.id = cm.account_id
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN autoreply_disabled_peers ad
       ON ad.account_id = cm.account_id AND ad.peer_id = cm.peer_id
     LEFT JOIN operator_lead_flags olf
       ON olf.account_id = cm.account_id AND olf.peer_id = cm.peer_id
     LEFT JOIN archived_peers ap
       ON ap.account_id = cm.account_id AND ap.peer_id = cm.peer_id
     LEFT JOIN cleared_peers cp
       ON cp.account_id = cm.account_id AND cp.peer_id = cm.peer_id
     WHERE COALESCE(u.is_blocked, 0) = 0
       AND cp.peer_id IS NULL
       AND (
         ap.peer_id IS NULL
         OR olf.funnel_stage = 'filtered'
         OR ad.reason = 'filtered'
       )
     GROUP BY cm.account_id, cm.peer_id
     HAVING (
       MAX(CASE WHEN olf.focus = 1 THEN 1 ELSE 0 END) = 1
       OR MAX(CASE WHEN cm.role = 'user' THEN cm.created_at END) >= (NOW() - INTERVAL 7 DAY)
       OR (
         (
           MAX(olf.funnel_stage) IN ('filtered', 'day3', 'day4', 'pitch', 'operator', 'interest')
           OR MAX(ad.reason) IN ('filtered', 'nft_voice_sent', 'operator_pause')
         )
         AND MAX(CASE WHEN cm.role = 'user' THEN cm.created_at END)
           >= (NOW() - INTERVAL 14 DAY)
       )
     )
     ORDER BY last_user_at DESC
     LIMIT ${lim}`,
  );

  const list = rows.map((row) => {
    const { score, tier } = scoreConversation(row);
    const funnel = detectFunnelStage(row, score);
    const lastUserMs = row.last_user_at ? new Date(row.last_user_at).getTime() : 0;
    const lastMs = row.last_at ? new Date(row.last_at).getTime() : 0;
    const lastIsUser = lastUserMs > 0 && lastUserMs >= lastMs - 1500;
    const handledBy =
      Number(row.operator_focus) === 1 || Number(row.autoreply_disabled) === 1
        ? 'operator'
        : 'ai';
    return {
      account_id: row.account_id,
      peer_id: row.peer_id,
      peer_username: row.peer_username,
      snippet: cleanBoardSnippet(row.last_user_text),
      message_count: Number(row.message_count || 0),
      last_at: row.last_at,
      last_user_at: row.last_user_at,
      age_hours: Number(row.age_hours || 0),
      account_phone: row.account_phone,
      worker: row.worker_username ? `@${row.worker_username}` : null,
      autoreply_disabled: Number(row.autoreply_disabled) === 1,
      operator_focus: Number(row.operator_focus) === 1,
      lead_score: score,
      lead_tier: tier,
      funnel_stage: funnel.stage,
      funnel_label: FUNNEL_LABELS[funnel.stage] || funnel.stage,
      waiting: Boolean(lastIsUser),
      handled_by: handledBy,
    };
  });

  const funnelCounts = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0]));
  for (const c of list) {
    if (funnelCounts[c.funnel_stage] != null) funnelCounts[c.funnel_stage] += 1;
  }

  return {
    conversations: list,
    funnel: funnelCounts,
    stages: FUNNEL_BOARD_STAGES,
    labels: FUNNEL_LABELS,
  };
}

async function assertAccountOwned(userId, accountId) {
  const [[account]] = await db.execute(
    'SELECT id FROM accounts WHERE id = ? AND user_id = ? LIMIT 1',
    [accountId, userId],
  );
  return Boolean(account);
}

async function upsertLeadFlags(accountId, peerId, patch) {
  await ensureSchema();
  const focus = patch.focus != null ? (patch.focus ? 1 : 0) : null;
  const note = patch.note !== undefined ? patch.note : undefined;
  const funnel =
    patch.funnel_stage === null || patch.funnel_stage === ''
      ? null
      : patch.funnel_stage && FUNNEL_STAGES.includes(patch.funnel_stage)
        ? patch.funnel_stage
        : undefined;

  const [[existing]] = await db.execute(
    `SELECT focus, note, funnel_stage FROM operator_lead_flags
     WHERE account_id = ? AND peer_id = ? LIMIT 1`,
    [accountId, peerId],
  );

  const nextFocus = focus != null ? focus : existing ? Number(existing.focus) : 0;
  const nextNote = note !== undefined ? note : existing ? existing.note : null;
  const nextFunnel =
    funnel !== undefined ? funnel : existing ? existing.funnel_stage : null;

  if (!nextFocus && !nextNote && !nextFunnel) {
    await db.execute(
      'DELETE FROM operator_lead_flags WHERE account_id = ? AND peer_id = ?',
      [accountId, peerId],
    );
    return { focus: false, funnel_stage: null };
  }

  await db.execute(
    `INSERT INTO operator_lead_flags (account_id, peer_id, focus, note, funnel_stage)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       focus = VALUES(focus),
       note = VALUES(note),
       funnel_stage = VALUES(funnel_stage)`,
    [accountId, peerId, nextFocus, nextNote, nextFunnel],
  );
  return {
    focus: Boolean(nextFocus),
    funnel_stage: nextFunnel,
    funnel_auto: !nextFunnel,
    funnel_label: nextFunnel ? FUNNEL_LABELS[nextFunnel] : null,
  };
}

async function setOperatorFocus(userId, accountId, peerId, focus, note = null) {
  if (!(await assertAccountOwned(userId, accountId))) {
    const err = new Error('Аккаунт не найден');
    err.status = 404;
    throw err;
  }
  return upsertLeadFlags(accountId, peerId, {
    focus: Boolean(focus),
    note: note != null ? note : undefined,
  });
}

async function getAutoreplyDisableReason(accountId, peerId) {
  const [[row]] = await db.execute(
    `SELECT reason FROM autoreply_disabled_peers
     WHERE account_id = ? AND peer_id = ? LIMIT 1`,
    [accountId, String(peerId)],
  );
  return row?.reason || null;
}

async function buildDialogDigest(accountId, peerId, limit = 8) {
  const lim = Math.min(20, Math.max(3, Number(limit) || 8));
  const [rows] = await db.execute(
    `SELECT role, LEFT(content, 140) AS content
     FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ${lim}`,
    [accountId, String(peerId)],
  );
  const lines = [];
  for (const r of [...rows].reverse()) {
    const who = r.role === 'user' ? 'Он' : 'Она';
    const text = String(r.content || '')
      .replace(/\s+/g, ' ')
      .replace(/\[реакция:[^\]]*\]/gi, '')
      .trim();
    if (!text) continue;
    const line = `${who}: ${text}`;
    // Подряд одинаковые строки — артефакт ретраев saveMessage, не новый ход.
    if (lines.length && lines[lines.length - 1] === line) continue;
    lines.push(line);
  }
  return lines.join('\n');
}

/**
 * Один раз пушит оператору дайджест, когда лид стал «готов» (предложка/оператор).
 */
async function maybeNotifyLeadReady(accountId, peerId, reason = 'ready') {
  await ensureSchema();
  const peer = String(peerId);
  const [[flags]] = await db.execute(
    `SELECT digest_sent_at, funnel_stage FROM operator_lead_flags
     WHERE account_id = ? AND peer_id = ? LIMIT 1`,
    [accountId, peer],
  );
  if (flags?.digest_sent_at) return false;

  const [[acc]] = await db.execute(
    `SELECT phone FROM accounts WHERE id = ? LIMIT 1`,
    [accountId],
  );
  const [[peerRow]] = await db.execute(
    `SELECT peer_username FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?
     ORDER BY created_at DESC LIMIT 1`,
    [accountId, peer],
  );
  const digest = await buildDialogDigest(accountId, peer);
  const notifier = require('./helpRequestNotifier');
  let accountName = null;
  try {
    const { accountDisplayName } = require('./telegramClient');
    accountName = accountDisplayName(accountId);
  } catch (_) {
    /* optional */
  }
  // #17: явный акцент «ручное касание» для оператора.
  let hotTouchExtra = null;
  try {
    hotTouchExtra = require('./scaleIdeasPack').formatHotLeadAlert({
      accountName,
      phone: acc?.phone || null,
      peerName: peerRow?.peer_username || peer,
      reason,
    });
  } catch (_) {
    /* optional */
  }
  const notified = await notifier.notifyLeadReady({
    accountId,
    accountPhone: acc?.phone || null,
    accountName,
    peerId: peer,
    peerUsername: peerRow?.peer_username || null,
    reason,
    digest,
    manualTouchHint: hotTouchExtra,
  });

  // digest_sent_at только после успешной доставки — иначе ИИ на паузе, а оператор без карточки.
  if (!notified) {
    console.log(
      `[leadScoring] Лид ${accountId}/${peer}: notify не дошёл — digest_sent_at не ставлю, будет ретрай.`,
    );
    return false;
  }

  await db.execute(
    `INSERT INTO operator_lead_flags (account_id, peer_id, focus, note, funnel_stage, digest_sent_at)
     VALUES (?, ?, 0, NULL, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE digest_sent_at = CURRENT_TIMESTAMP`,
    [accountId, peer, flags?.funnel_stage || 'day4'],
  );
  return true;
}

async function setFunnelStage(userId, accountId, peerId, stage) {
  if (!(await assertAccountOwned(userId, accountId))) {
    const err = new Error('Аккаунт не найден');
    err.status = 404;
    throw err;
  }
  const normalized =
    stage === null || stage === '' || stage === 'auto' ? null : normalizeFunnelStage(stage);
  if (stage && stage !== 'auto' && stage !== null && stage !== '' && !normalized) {
    const err = new Error('Неизвестный этап воронки');
    err.status = 400;
    throw err;
  }
  const value = normalized;

  const {
    disableAutoreplyForPeer,
    enableAutoreplyForPeer,
  } = require('./helpRequestNotifier');

  const result = await upsertLeadFlags(accountId, peerId, { funnel_stage: value });

  if (value === 'filtered') {
    await disableAutoreplyForPeer(accountId, peerId, 'filtered');
    // Ручной отсев — причина на карточке, если note пустой.
    try {
      const [[row]] = await db.execute(
        `SELECT note FROM operator_lead_flags WHERE account_id = ? AND peer_id = ? LIMIT 1`,
        [accountId, String(peerId)],
      );
      if (!row?.note || !/^отсев:/i.test(String(row.note))) {
        const { formatFilterNote } = require('./opsQuality');
        await upsertLeadFlags(accountId, peerId, {
          funnel_stage: 'filtered',
          note: formatFilterNote('manual'),
        });
      }
    } catch (_) {
      /* ignore */
    }
  } else {
    const reason = await getAutoreplyDisableReason(accountId, peerId);
    if (reason === 'filtered') {
      await enableAutoreplyForPeer(accountId, peerId);
    }
  }

  if (value && READY_STAGES.has(value)) {
    maybeNotifyLeadReady(accountId, peerId, value).catch((e) =>
      console.error('[leadScoring] digest notify:', e.message),
    );
  } else if (value && !READY_STAGES.has(value) && value !== 'filtered') {
    // Сброс флага — можно снова уведомить, если снова станет «готов».
    await db.execute(
      `UPDATE operator_lead_flags SET digest_sent_at = NULL
       WHERE account_id = ? AND peer_id = ?`,
      [accountId, String(peerId)],
    );
  }

  return result;
}

async function setAutoreplyPaused(userId, accountId, peerId, paused) {
  if (!(await assertAccountOwned(userId, accountId))) {
    const err = new Error('Аккаунт не найден');
    err.status = 404;
    throw err;
  }
  const {
    disableAutoreplyForPeer,
    enableAutoreplyForPeer,
    isAutoreplyDisabledForPeer,
  } = require('./helpRequestNotifier');
  if (paused) {
    await disableAutoreplyForPeer(accountId, peerId, 'operator_pause');
    // Пауза = оператор взял чат → день 4 NFT (хендофф).
    await upsertLeadFlags(accountId, peerId, { funnel_stage: 'day4' });
    maybeNotifyLeadReady(accountId, peerId, 'day4').catch((e) =>
      console.error('[leadScoring] digest notify:', e.message),
    );
  } else {
    const reason = await getAutoreplyDisableReason(accountId, peerId);
    if (reason === 'nft_voice_sent') {
      // NFT-хендофф нельзя снять обычным resume — иначе снова питч.
      return {
        autoreply_disabled: true,
        kept: 'nft_voice_sent',
      };
    }
    await enableAutoreplyForPeer(accountId, peerId, {
      onlyReasons: ['operator_pause', 'filtered'],
    });
    // Если был отсев — снимаем этап, иначе оставляем ручной.
    if (reason === 'filtered') {
      await upsertLeadFlags(accountId, peerId, { funnel_stage: null });
    }
  }
  return { autoreply_disabled: await isAutoreplyDisabledForPeer(accountId, peerId) };
}

/**
 * Автоотсев: howlong ≥21д | молчит 2д.
 * Ручной — setFunnelStage / allowManual.
 */
async function markPeerFiltered(accountId, peerId, note = null, opts = {}) {
  await ensureSchema();
  let finalNote = note != null ? String(note).slice(0, 240) : null;
  if (!finalNote) {
    const { formatFilterNote } = require('./opsQuality');
    finalNote = formatFilterNote('howlong');
  }
  const allow =
    opts.allowManual === true ||
    /давно\s+на\s+дв/i.test(finalNote) ||
    /молчит/i.test(finalNote);
  if (!allow) {
    console.warn(
      `[leadScoring] markPeerFiltered отказ peer=${peerId}: howlong|молчит`,
      finalNote,
    );
    return { skipped: true, reason: 'only_allowed_filters', note: finalNote };
  }
  await upsertLeadFlags(accountId, peerId, {
    funnel_stage: 'filtered',
    note: finalNote,
  });
  const { disableAutoreplyForPeer } = require('./helpRequestNotifier');
  await disableAutoreplyForPeer(accountId, peerId, 'filtered');
  return { funnel_stage: 'filtered', note: finalNote };
}

/** Вызов из telegramClient после NFT-голоса / готовности лида. */
async function onLeadBecameReady(accountId, peerId, reason = 'pitch') {
  await ensureSchema();
  const stage = reason === 'operator' ? 'operator' : 'pitch';
  await upsertLeadFlags(accountId, peerId, { funnel_stage: stage });
  return maybeNotifyLeadReady(accountId, peerId, reason);
}

/**
 * Быстрый score/tier одного пира (для NFT timing) — без LLM.
 * @returns {Promise<{score:number,tier:string}|null>}
 */
async function getPeerScoreSnapshot(accountId, peerId) {
  try {
    await ensureSchema();
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS message_count,
              SUM(role = 'user') AS user_msgs,
              SUM(role = 'assistant') AS bot_msgs,
              MAX(created_at) AS last_at,
              SUM(role = 'user' AND (${HOT_SQL})) AS hot_hits,
              SUM(role = 'user' AND (${COLD_SQL})) AS cold_hits,
              0 AS operator_focus,
              0 AS autoreply_disabled
       FROM conversation_messages
       WHERE account_id = ? AND peer_id = ?`,
      [accountId, String(peerId)],
    );
    if (!row || !Number(row.message_count)) return { score: 0, tier: 'cold' };
    return scoreConversation(row);
  } catch (_) {
    return null;
  }
}

module.exports = {
  FUNNEL_STAGES,
  FUNNEL_BOARD_STAGES,
  FUNNEL_LABELS,
  ensureSchema,
  scoreConversation,
  detectFunnelStage,
  dayStageFromAge,
  cleanBoardSnippet,
  normalizeFunnelStage,
  getPeerScoreSnapshot,
  listScoredConversations,
  listGlobalScoredConversations,
  setOperatorFocus,
  setFunnelStage,
  setAutoreplyPaused,
  markPeerFiltered,
  upsertLeadFlags,
  markPeerArchived,
  markPeerUnarchived,
  markPeerCleared,
  unmarkPeerCleared,
  isPeerCleared,
  clearPeerConversation,
  syncArchiveFlags,
  maybeNotifyLeadReady,
  onLeadBecameReady,
  buildDialogDigest,
};
