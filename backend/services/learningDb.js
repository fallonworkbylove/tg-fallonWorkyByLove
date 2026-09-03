const crypto = require('crypto');
const db = require('../db');
const OpenAI = require('openai');

// ---------------------------------------------------------------------------
// ОБУЧЕНИЕ БЕЗ FINE-TUNING.
//
// Идея (упрощённая версия python-примера с реальным fine-tuning модели):
// вместо того чтобы дообучать саму модель (дорого, и OpenAI больше не даёт
// fine-tuning новым аккаунтам), мы копим статистику "какие фразы бота
// хорошо/плохо сработали" и подмешиваем ЛУЧШИЕ примеры прямо в системный
// промпт перед каждым ответом. Модель остаётся стандартной (gpt-4o-mini/
// gpt-4o) — никакой доплаты за инференс, только 1 короткий доп. запрос на
// оценку реакции собеседника.
//
// Цикл работы:
//   1. Бот отвечает -> recordBotReply() запоминает пару (что сказал
//      собеседник -> что ответил бот) как "ожидающую оценки".
//   2. Собеседник пишет следующее сообщение -> scoreAndLearn() смотрит на
//      это сообщение как на РЕАКЦИЮ на предыдущий ответ бота, просит
//      gpt-4o-mini оценить её (good/neutral/bad) и обновляет рейтинг фразы.
//   3. При каждой генерации нового ответа buildLearningSnippet() достаёт
//      несколько лучших фраз (по всем аккаунтам сразу — обучение общее) и
//      добавляет их в промпт как примеры удачных ответов.
//
// Обучение общее для всех профилей: bot_patterns не хранит account_id,
// поэтому удачная фраза с одного аккаунта подсказывает всем остальным.
// ---------------------------------------------------------------------------

const LEARNING_ENABLED = process.env.LEARNING_ENABLED !== '0' && process.env.LEARNING_ENABLED !== 'false';

// Отдельный лёгкий клиент для оценки реакции (та же авторизация, что и у
// основного чата — прокси/ключ настраивать не нужно повторно).
const scorerClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function ensureTables() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bot_patterns (
      id INT AUTO_INCREMENT PRIMARY KEY,
      trigger_msg TEXT,
      bot_reply TEXT,
      bot_reply_hash CHAR(32) NOT NULL,
      uses INT NOT NULL DEFAULT 0,
      success_score FLOAT NOT NULL DEFAULT 0,
      success_rate FLOAT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_reply_hash (bot_reply_hash)
    )
  `);

  // Одна "ожидающая оценки" пара на диалог (account_id + peer_id) — новая
  // всегда перезатирает старую, если собеседник так и не ответил.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pending_reactions (
      account_id INT NOT NULL,
      peer_id VARCHAR(64) NOT NULL,
      user_msg TEXT,
      bot_reply TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (account_id, peer_id)
    )
  `);
}

const tablesReady = ensureTables().catch((err) => {
  console.error('[learningDb] Не удалось создать таблицы обучения:', err.message);
});

function hashReply(text) {
  return crypto.createHash('md5').update(String(text || '').trim().toLowerCase()).digest('hex');
}

/**
 * Запоминает пару (сообщение собеседника -> ответ бота) как ожидающую
 * оценки реакции. Вызывается сразу после того, как бот отправил ответ.
 */
async function recordBotReply(accountId, peerId, userMsg, botReply) {
  if (!LEARNING_ENABLED || !botReply) return;
  try {
    await tablesReady;
    await db.execute(
      `INSERT INTO pending_reactions (account_id, peer_id, user_msg, bot_reply)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE user_msg = VALUES(user_msg), bot_reply = VALUES(bot_reply), created_at = CURRENT_TIMESTAMP`,
      [accountId, peerId, userMsg || '', botReply],
    );
  } catch (err) {
    console.error('[learningDb] Не удалось сохранить ожидающую пару:', err.message);
  }
}

/**
 * Просит gpt-4o-mini коротко оценить реакцию собеседника на предыдущий
 * ответ бота. Возвращает число: 1 (good), 0.5 (neutral), 0 (bad).
 */
async function scoreReaction(botReply, userReaction) {
  try {
    const completion = await scorerClient.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 5,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Ты оцениваешь переписку в мессенджере. Тебе дана фраза бота и следующий ' +
            'ответ собеседника на неё. Определи, как собеседник отреагировал: ' +
            'GOOD — заинтересованно, тепло, продолжил разговор, задал вопрос в ответ; ' +
            'NEUTRAL — нейтрально, коротко, без явного интереса или отказа; ' +
            'BAD — холодно, раздражённо, разочарованно, проигнорировал суть, оборвал разговор. ' +
            'Ответь строго одним словом: GOOD, NEUTRAL или BAD.',
        },
        {
          role: 'user',
          content: `Фраза бота: "${botReply}"\nОтвет собеседника: "${userReaction}"`,
        },
      ],
    });
    const verdict = (completion.choices[0]?.message?.content || '').trim().toUpperCase();
    if (verdict.includes('GOOD')) return 1;
    if (verdict.includes('BAD')) return 0;
    return 0.5;
  } catch (err) {
    console.error('[learningDb] Не удалось оценить реакцию:', err.message);
    return null;
  }
}

/**
 * Смотрит, есть ли для этого диалога ответ бота, ожидающий оценки, и если
 * да — оценивает реакцию собеседника (его НОВОЕ сообщение) и обновляет
 * рейтинг фразы в bot_patterns. Вызывается перед генерацией нового ответа,
 * когда пришло новое сообщение от собеседника.
 */
async function scoreAndLearn(accountId, peerId, newUserMsg) {
  if (!LEARNING_ENABLED) return;
  try {
    await tablesReady;
    const [rows] = await db.execute(
      `SELECT user_msg, bot_reply FROM pending_reactions WHERE account_id = ? AND peer_id = ? LIMIT 1`,
      [accountId, peerId],
    );
    if (!rows.length) return;
    const { user_msg: triggerMsg, bot_reply: botReply } = rows[0];

    // Пара сразу удаляется, чтобы не оценить её повторно.
    await db.execute(`DELETE FROM pending_reactions WHERE account_id = ? AND peer_id = ?`, [accountId, peerId]);

    const score = await scoreReaction(botReply, newUserMsg);
    if (score === null) return;

    const hash = hashReply(botReply);
    await db.execute(
      `INSERT INTO bot_patterns (trigger_msg, bot_reply, bot_reply_hash, uses, success_score, success_rate)
       VALUES (?, ?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE
         uses = uses + 1,
         success_score = success_score + ?,
         success_rate = (success_score + ?) / (uses + 1)`,
      [triggerMsg || '', botReply, hash, score, score, score, score],
    );
  } catch (err) {
    console.error('[learningDb] Не удалось обучиться на реакции:', err.message);
  }
}

/**
 * Достаёт несколько лучших фраз (по всем аккаунтам) для подмешивания в
 * промпт. Требует минимум использований, чтобы рейтинг не был случайным.
 */
async function getBestPatterns(limit = 4, minUses = 2, minRate = 0.6) {
  try {
    await tablesReady;
    const [rows] = await db.execute(
      `SELECT trigger_msg, bot_reply, success_rate FROM bot_patterns
       WHERE uses >= ? AND success_rate >= ?
       ORDER BY success_rate DESC, uses DESC
       LIMIT ${Number(limit) || 4}`,
      [minUses, minRate],
    );
    return rows;
  } catch (err) {
    console.error('[learningDb] Не удалось получить лучшие паттерны:', err.message);
    return [];
  }
}

/**
 * Формирует текстовый блок с примерами удачных фраз для вставки в системный
 * промпт. Возвращает пустую строку, если обучение выключено или подходящих
 * примеров пока нет (мало данных).
 */
async function buildLearningSnippet() {
  if (!LEARNING_ENABLED) return '';
  const patterns = await getBestPatterns();
  if (!patterns.length) return '';

  let snippet = '\n\n=== ОБУЧЕНИЕ НА ПРОШЛОМ ОПЫТЕ ===\n';
  snippet += 'Вот примеры фраз, которые хорошо сработали в похожих ситуациях в других диалогах:\n';
  for (const p of patterns) {
    const trigger = (p.trigger_msg || '').slice(0, 150);
    const reply = (p.bot_reply || '').slice(0, 200);
    snippet += `— Если собеседник пишет что-то в духе «${trigger}», хорошо сработал ответ: «${reply}» (успех: ${Math.round(p.success_rate * 100)}%)\n`;
  }
  snippet += 'Не копируй эти примеры дословно — адаптируй саму идею под текущий диалог и характер персонажа.\n';
  return snippet;
}

module.exports = {
  LEARNING_ENABLED,
  recordBotReply,
  scoreAndLearn,
  buildLearningSnippet,
  getBestPatterns,
};
