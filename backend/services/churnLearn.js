/**
 * Когда чат «пропал» (удалили сообщение/диалог, блок, deactivated) —
 * классифицируем причину по хвосту истории и учим learningDb на негативе.
 * Telegram не всегда шлёт «удалил чат» — ловим доступные сигналы.
 */
const db = require('../db');
const { accountLabel } = require('./clientPool');

const CHURN_ENABLED = process.env.CHURN_LEARN_ENABLED !== '0' && process.env.CHURN_LEARN_ENABLED !== 'false';

/** Не чаще N негативных pin/час на весь бот. */
const MAX_NEG_PER_HOUR = 12;
let negWindowStart = Date.now();
let negCount = 0;

const tablesReady = ensureTables().catch((err) => {
  console.error('[churnLearn] schema:', err.message);
});

async function ensureTables() {
  // churn_signal — не signal (reserved в MySQL)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS dialog_churn_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      account_id INT NOT NULL,
      peer_id VARCHAR(64) NOT NULL,
      churn_signal VARCHAR(64) NOT NULL,
      reason VARCHAR(64) NOT NULL,
      last_user_msg TEXT,
      last_bot_reply TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_churn_peer (account_id, peer_id, created_at),
      KEY idx_churn_created (created_at),
      KEY idx_churn_reason (reason)
    )
  `);
}

function classifyChurnReason(history) {
  const hist = Array.isArray(history) ? history : [];
  const tail = hist.slice(-10);
  const blob = tail.map((h) => String(h && h.content ? h.content : '')).join('\n');
  const lastBot = [...tail].reverse().find((h) => h && h.role === 'assistant');
  const lastUser = [...tail].reverse().find((h) => h && h.role === 'user');
  const bot = String(lastBot && lastBot.content ? lastBot.content : '');
  const user = String(lastUser && lastUser.content ? lastUser.content : '');

  if (
    /ты\s+бот|нейросет|chatgpt|как\s+робот|are\s+you\s+a?\s*bot/i.test(user) ||
    /хах\s+ну\s+ты\s+серьёзно|ну\s+ты\s+зациклился|ладно\s+верь/i.test(bot)
  ) {
    return 'after_bot_accusation';
  }
  if (
    /флип|токен|\bnft\b|нфт|коллекц|whitelist|вайтлист|цифров/i.test(bot) ||
    /\[фото от меня:.*флип|скриншот прибыли/i.test(blob)
  ) {
    return 'after_nft_pitch';
  }
  if (/встрет|погуля|свидан|кофе\s+вместе|жду\s+тебя/i.test(user) && /не\s+до\s+встреч|только\s+(?:тут|переписк)|коробк/i.test(bot)) {
    return 'after_meet_refuse';
  }
  if (/инст|whatsapp|номер|вконтакте|\bвк\b|ссылк/i.test(user) && /не\s+даю|давай\s+(?:лучше\s+)?тут|инсту\s+не/i.test(bot)) {
    return 'after_contact_refuse';
  }
  if (/скучн|однотип|повторя|как\s+бот|скрипт/i.test(user)) {
    return 'after_quality_complaint';
  }
  return 'unknown';
}

async function alreadyLoggedToday(accountId, peerId, signal) {
  const [rows] = await db.execute(
    `SELECT id FROM dialog_churn_events
     WHERE account_id = ? AND peer_id = ? AND churn_signal = ?
       AND created_at >= (NOW() - INTERVAL 1 DAY)
     LIMIT 1`,
    [accountId, String(peerId), String(signal)],
  );
  return rows.length > 0;
}

async function loadRecentHistory(accountId, peerId, limit = 12) {
  try {
    const hist = require('./history');
    if (typeof hist.getHistory === 'function') {
      return await hist.getHistory(accountId, peerId);
    }
  } catch (_) {
    /* fallback below */
  }
  const [rows] = await db.execute(
    `SELECT role, content FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?
     ORDER BY id DESC
     LIMIT ${Math.max(4, limit)}`,
    [accountId, String(peerId)],
  );
  return rows.reverse();
}

/**
 * signal: peer_deleted_msg | blocked | deactivated | unreachable | dialog_gone
 */
async function recordChurn(accountId, peerId, signal, historyOpt = null) {
  if (!CHURN_ENABLED || accountId == null || peerId == null) return null;
  try {
    await tablesReady;
    if (await alreadyLoggedToday(accountId, peerId, signal)) return null;

    const history = historyOpt || (await loadRecentHistory(accountId, peerId));
    const reason = classifyChurnReason(history);
    const lastBot = [...(history || [])].reverse().find((h) => h && h.role === 'assistant');
    const lastUser = [...(history || [])].reverse().find((h) => h && h.role === 'user');
    const last_bot_reply = String(lastBot && lastBot.content ? lastBot.content : '').slice(0, 500);
    const last_user_msg = String(lastUser && lastUser.content ? lastUser.content : '').slice(0, 500);

    await db.execute(
      `INSERT INTO dialog_churn_events
       (account_id, peer_id, churn_signal, reason, last_user_msg, last_bot_reply)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [accountId, String(peerId), String(signal), reason, last_user_msg, last_bot_reply],
    );

    console.log(
      `[${accountLabel(accountId)}] churnLearn peer=${peerId} signal=${signal} reason=${reason}`,
    );

    await teachNegative(last_user_msg, last_bot_reply, reason, signal);
    return { reason, signal };
  } catch (err) {
    console.error('[churnLearn] record failed:', err.message);
    return null;
  }
}

async function teachNegative(userMsg, botReply, reason, signal) {
  if (!botReply || botReply.length < 6) return;
  // unknown без текста юзера — шум, не пиним
  if (reason === 'unknown' && (!userMsg || userMsg.length < 2)) return;

  if (Date.now() - negWindowStart > 60 * 60 * 1000) {
    negWindowStart = Date.now();
    negCount = 0;
  }
  if (negCount >= MAX_NEG_PER_HOUR) return;
  negCount += 1;

  try {
    const learningDb = require('./learningDb');
    if (typeof learningDb.recordChurnNegative === 'function') {
      await learningDb.recordChurnNegative({
        userMsg: userMsg || `(churn:${signal})`,
        botReply,
        reason,
        stage: reason === 'after_nft_pitch' ? 'nft_pitch' : 'general',
      });
    }
  } catch (err) {
    console.error('[churnLearn] teachNegative:', err.message);
  }
}

/** Хук из cancelReplyIfDialogGone / retireUnreachablePeer — fire-and-forget. */
function noteDialogGone(accountId, peerId, signal) {
  if (!CHURN_ENABLED) return;
  setImmediate(() => {
    recordChurn(accountId, peerId, signal).catch(() => {});
  });
}

async function recentChurnDigest(hours = 24) {
  await tablesReady;
  const [rows] = await db.execute(
    `SELECT reason, churn_signal AS signal, COUNT(*) AS c
     FROM dialog_churn_events
     WHERE created_at >= (NOW() - INTERVAL ? HOUR)
     GROUP BY reason, churn_signal
     ORDER BY c DESC`,
    [Number(hours) || 24],
  );
  return rows;
}

module.exports = {
  CHURN_ENABLED,
  classifyChurnReason,
  recordChurn,
  noteDialogGone,
  recentChurnDigest,
  ensureTables,
};
