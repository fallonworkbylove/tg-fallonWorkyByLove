/**
 * История диалогов: get/save, сессия после паузы, язык, возраст диалога.
 */
const db = require('../db');
const { isRussianConversation, detectReplyLanguage } = require('./aiResponder');
const { accountLabel } = require('./clientPool');

// Сколько последних сообщений диалога передавать модели как контекст.
// 0t4: ~90 — контекстная память 50–100 сообщений текущей сессии.
const HISTORY_LIMIT = 90;

/** Пауза ≥72ч — старый диалог в БД считаем законченным, возраст с нуля. */
const SESSION_GAP_HOURS = 72;
/** Нет входящих столько часов — активного диалога нет. */
const ACTIVE_DIALOGUE_IDLE_HOURS = 72;
/** Сообщение бота позже этого после предыдущего — не ответ, а инициатива. */
const PROACTIVE_GAP_MS = 60 * 60 * 1000;

/**
 * Достаёт последние сообщения диалога (в хронологическом порядке).
 */
async function getHistory(accountId, peerId) {
  const limit = Number(HISTORY_LIMIT) || 20;
  const [rows] = await db.execute(
    `SELECT role, content, created_at FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?
     ORDER BY id DESC
     LIMIT ${Math.max(limit * 3, 60)}`,
    [accountId, peerId],
  );
  const chronological = rows.reverse();
  return filterHistoryToCurrentSession(chronological, limit);
}

/**
 * Как человек: после паузы ≥72ч «забываем» старый диалог.
 * В промпт попадает только текущая сессия (после последнего большого гэпа).
 */
function filterHistoryToCurrentSession(rows, limit) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  let sessionStart = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = new Date(rows[i - 1].created_at).getTime();
    const cur = new Date(rows[i].created_at).getTime();
    if (!Number.isFinite(prev) || !Number.isFinite(cur)) continue;
    const gapHours = (cur - prev) / (60 * 60 * 1000);
    if (gapHours >= SESSION_GAP_HOURS) sessionStart = i;
  }
  return rows.slice(sessionStart).slice(-limit).map((r) => ({
    role: r.role,
    content: r.content,
    created_at: r.created_at,
  }));
}

/** Сессия только что началась после ≥72ч паузы — модели нельзя ссылаться на «старое». */
function isFreshSessionAfterGap(history) {
  if (!Array.isArray(history) || history.length === 0) return false;
  return history.length <= 4;
}

/**
 * Эмоции по паузе: радость после долгого возврата, лёгкая обида если игнорил.
 * history — до текущего входящего (ещё не сохранено).
 */
function buildEmotionHint(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const last = history[history.length - 1];
  if (!last || !last.created_at) return null;
  const idleHours = (Date.now() - new Date(last.created_at).getTime()) / (60 * 60 * 1000);
  if (!Number.isFinite(idleHours) || idleHours < 0) return null;

  if (idleHours >= 18) {
    return (
      'ЭМОЦИЯ: он написал после долгого молчания (много часов/сутки+). ' +
      'Лёгкая радость что объявился — коротко и тепло («о живой)», «ну наконец)» и т.п.). ' +
      'БЕЗ допроса и без вопроса в конце обязательного.'
    );
  }
  if (idleHours >= 6 && last.role === 'assistant') {
    return (
      'ЭМОЦИЯ: ты писала, он долго не отвечал и вот объявился. Можно чуть задеть / сарказм ' +
      '(«ну надо же», «а я уж думала пропал)») — одно короткое предложение, без драмы и без эссе.'
    );
  }
  return null;
}

function buildSessionForgetHint(historyWasTrimmed) {
  if (!historyWasTrimmed) return null;
  return (
    'ПАМЯТЬ: это как будто новый заход в переписку после длинной паузы. ' +
    'НЕ ссылайся на старые темы/факты которых нет в истории выше. Общайся как с начала знакомства, тепло и коротко.'
  );
}

/**
 * Диалог на русском? Голосовые заготовки (русские ogg) не шлём англоязычным.
 */
async function conversationIsRussian(accountId, peerId, latestText = '') {
  try {
    const history = await getHistory(accountId, peerId);
    return isRussianConversation(latestText, history);
  } catch (_) {
    return isRussianConversation(latestText, []);
  }
}

/** Язык ответа для этого диалога: 'ru' | 'en' | 'de'. */
async function conversationReplyLang(accountId, peerId, latestText = '') {
  try {
    const history = await getHistory(accountId, peerId);
    return detectReplyLanguage(latestText, history);
  } catch (_) {
    return detectReplyLanguage(latestText, []);
  }
}

/**
 * Сохраняет одно сообщение диалога в историю.
 * Повторный INSERT того же role+content подряд пропускаем.
 */
async function saveMessage(accountId, peerId, peerUsername, role, content) {
  const normalized = String(content || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  try {
    const [recent] = await db.execute(
      `SELECT role, content FROM conversation_messages
       WHERE account_id = ? AND peer_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [accountId, peerId],
    );
    if (recent[0]) {
      const prev = String(recent[0].content || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (recent[0].role === role && prev === normalized) {
        return false;
      }
    }
  } catch (_) {
    /* best-effort */
  }
  await db.execute(
    `INSERT INTO conversation_messages (account_id, peer_id, peer_username, role, content)
     VALUES (?, ?, ?, ?, ?)`,
    [accountId, peerId, peerUsername, role, content],
  );
  return true;
}

/** Метка голосового в истории. */
function voiceTag(fileName) {
  return `[голосовое: ${fileName}]`;
}

async function wasVoiceSent(accountId, peerId, fileName) {
  const likeName = String(fileName).replace(/[\\%_]/g, '\\$&');
  const [rows] = await db.execute(
    `SELECT id FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?
       AND (content = ? OR content LIKE ? ESCAPE '\\\\')
     LIMIT 1`,
    [accountId, peerId, voiceTag(fileName), `%: ${likeName}]`],
  );
  return rows.length > 0;
}

async function wasAnyVoiceSent(accountId, peerId) {
  const [rows] = await db.execute(
    `SELECT id FROM conversation_messages
     WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
     AND content LIKE '[голосовое:%'
     AND content NOT LIKE '%kak_prohodit_den%'
     AND content NOT LIKE '%как проходит%'
     LIMIT 1`,
    [accountId, peerId],
  );
  return rows.length > 0;
}

async function lastAnyVoiceSentAt(accountId, peerId) {
  const [rows] = await db.execute(
    `SELECT created_at FROM conversation_messages
     WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
     AND content LIKE '[голосовое:%'
     ORDER BY id DESC LIMIT 1`,
    [accountId, peerId],
  );
  if (!rows.length) return null;
  const t = new Date(rows[0].created_at).getTime();
  return Number.isFinite(t) ? t : null;
}

async function lastIncomingText(accountId, peerId) {
  const [rows] = await db.execute(
    `SELECT content FROM conversation_messages
     WHERE account_id = ? AND peer_id = ? AND role = 'user'
     ORDER BY id DESC LIMIT 1`,
    [accountId, peerId],
  );
  return rows.length ? String(rows[0].content || '') : '';
}

async function getDialogTail(accountId, peerId) {
  const [rows] = await db.execute(
    `SELECT role, content FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?
     ORDER BY id DESC
     LIMIT 30`,
    [accountId, String(peerId)],
  );
  const hasIncoming = rows.some((row) => row.role === 'user');
  const lastRole = rows[0]?.role || null;
  return { hasIncoming, lastRole };
}

/** Минут с последнего входящего от человека (null — входящих нет). */
async function lastIncomingAgeMin(accountId, peerId) {
  const [[row]] = await db.execute(
    `SELECT TIMESTAMPDIFF(SECOND, MAX(created_at), NOW()) AS age_sec
     FROM conversation_messages
     WHERE account_id = ? AND peer_id = ? AND role = 'user'`,
    [accountId, String(peerId)],
  );
  if (!row || row.age_sec == null) return null;
  return Number(row.age_sec) / 60;
}

/**
 * Уже висит наша инициатива без ответа — вторую не шлём, пока он не напишет.
 */
async function hasUnansweredProactive(accountId, peerId) {
  const [rows] = await db.execute(
    `SELECT role, created_at FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?
     ORDER BY id DESC
     LIMIT 20`,
    [accountId, String(peerId)],
  );
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].role === 'user') return false;
    const prev = rows[i + 1];
    if (!prev) return true;
    const gap = new Date(rows[i].created_at).getTime() - new Date(prev.created_at).getTime();
    if (gap > PROACTIVE_GAP_MS) return true;
  }
  return rows.length > 0;
}

/**
 * Часы с начала ТЕКУЩЕЙ сессии диалога.
 * null — истории нет или человек давно не писал.
 */
async function getDialogAgeHours(accountId, peerId) {
  try {
    // Хвост сессии (новые сверху) — без полной истории peer на десятки тысяч строк.
    const [rows] = await db.execute(
      `SELECT role, created_at FROM conversation_messages
       WHERE account_id = ? AND peer_id = ?
       ORDER BY id DESC
       LIMIT 400`,
      [accountId, peerId],
    );
    if (!rows.length) return null;

    let lastUserAt = null;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].role === 'user') {
        lastUserAt = new Date(rows[i].created_at);
        break;
      }
    }
    if (!lastUserAt) return null;
    const idleHours = (Date.now() - lastUserAt.getTime()) / (60 * 60 * 1000);
    if (idleHours > ACTIVE_DIALOGUE_IDLE_HOURS) return null;

    // Ищем гэп ≥ SESSION_GAP вниз по времени; без гэпа — старт = самый старый в окне.
    let sessionStart = new Date(rows[rows.length - 1].created_at);
    for (let i = 0; i < rows.length - 1; i++) {
      const newer = new Date(rows[i].created_at).getTime();
      const older = new Date(rows[i + 1].created_at).getTime();
      const gapHours = (newer - older) / (60 * 60 * 1000);
      if (gapHours >= SESSION_GAP_HOURS) {
        sessionStart = new Date(rows[i].created_at);
        break;
      }
    }

    return (Date.now() - sessionStart.getTime()) / (60 * 60 * 1000);
  } catch (err) {
    console.error(
      `[${accountLabel(accountId)}] Не смог посчитать возраст диалога (NFT-кампания выключена):`,
      err.message,
    );
    return null;
  }
}

module.exports = {
  HISTORY_LIMIT,
  SESSION_GAP_HOURS,
  ACTIVE_DIALOGUE_IDLE_HOURS,
  PROACTIVE_GAP_MS,
  getHistory,
  filterHistoryToCurrentSession,
  isFreshSessionAfterGap,
  buildEmotionHint,
  buildSessionForgetHint,
  conversationIsRussian,
  conversationReplyLang,
  saveMessage,
  voiceTag,
  wasVoiceSent,
  wasAnyVoiceSent,
  lastAnyVoiceSentAt,
  lastIncomingText,
  getDialogTail,
  lastIncomingAgeMin,
  hasUnansweredProactive,
  getDialogAgeHours,
};
