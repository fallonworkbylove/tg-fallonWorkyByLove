/**
 * COMPLIMENT ENGINE — бот подмечает поведение собеседника (заботится, шутит,
 * пишет длинные вовлечённые сообщения, интересуется её жизнью) и иногда,
 * не чаще раза в сутки на диалог и не с первых сообщений, вплетает в ответ
 * лёгкий комплимент по конкретному замеченному поводу.
 *
 * Никогда не выдаёт готовый текст — только подсказку для generateReply,
 * какой именно повод для комплимента заметен, а модель формулирует сама,
 * коротко и без приторности (см. HINT-словарь ниже).
 */

const db = require('../db');

let schemaReady = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = db.execute(`
    CREATE TABLE IF NOT EXISTS peer_compliment_state (
      account_id INT NOT NULL,
      peer_id VARCHAR(64) NOT NULL,
      incoming_count INT NOT NULL DEFAULT 0,
      last_compliment_at DATETIME NULL,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (account_id, peer_id)
    )
  `);
  return schemaReady;
}

// Не хвалим раньше 3-го сообщения собеседника — иначе выглядит подозрительно
// (комплимент почти незнакомому человеку с первых слов).
const MIN_INCOMING_COUNT = 3;
// Не чаще одного комплимента за сутки на диалог.
const COOLDOWN_HOURS = 8;
// Даже когда все условия совпали, комплимент даётся не всегда — иначе на
// каждом подходящем сообщении бот хвалит одинаково механически.
const COMPLIMENT_CHANCE = 0.7;

// Порядок важен: первое совпадение по приоритету побеждает.
const BEHAVIOR_PATTERNS = [
  {
    type: 'caring',
    re: /(как ты|как дела\?|как настроение|как спалось|выспал|не устал|как самочувствие|береги себя|покушал|ты поел|тепло оделась)/i,
    hint:
      'Собеседник только что заботливо спросил о тебе самой (как дела/самочувствие/выспалась и т.п.). ' +
      'Вплети в ответ короткую тёплую ласку: что тебе приятно, когда о тебе заботятся, что с ним уютно, ' +
      'что ты рада ему. С любовью, но одной фразой, без речи.',
  },
  {
    type: 'funny',
    re: /(ха{2,}|бе{1}\)|🤣|😂|прикол|рж(у|ать|у)|смешно|шутиш|юмор)/i,
    hint:
      'Собеседник только что пошутил или рассмешил тебя. Вплети короткую тёплую фразу: что с ним легко, ' +
      'весело и ты его за это любишь. Одна фраза, без пафоса.',
  },
  {
    type: 'engaged',
    re: /.{80,}/,
    hint:
      'Собеседник написал длинное, вовлечённое сообщение. Коротко и тепло скажи, что тебе дорого, как он рассказывает, ' +
      'что с ним хочется говорить. Одна фраза, с любовью.',
  },
];

function detectBehavior(text) {
  const value = String(text || '');
  return BEHAVIOR_PATTERNS.find((p) => p.re.test(value)) || null;
}

/**
 * Возвращает подсказку для комплимента, если поведение собеседника подходит
 * и не сработал кулдаун/лимит частоты, либо null. Одновременно увеличивает
 * счётчик входящих сообщений (нужен для порога MIN_INCOMING_COUNT).
 */
async function getComplimentHint(accountId, peerId, text) {
  try {
    await ensureSchema();

    const [[row]] = await db.execute(
      `SELECT incoming_count, last_compliment_at FROM peer_compliment_state
       WHERE account_id = ? AND peer_id = ? LIMIT 1`,
      [accountId, String(peerId)],
    );

    const incomingCount = (row?.incoming_count || 0) + 1;

    await db.execute(
      `INSERT INTO peer_compliment_state (account_id, peer_id, incoming_count, last_compliment_at, updated_at)
       VALUES (?, ?, 1, NULL, NOW())
       ON DUPLICATE KEY UPDATE incoming_count = ?, updated_at = NOW()`,
      [accountId, String(peerId), incomingCount],
    );

    if (incomingCount < MIN_INCOMING_COUNT) return null;

    if (row?.last_compliment_at) {
      const hoursSince = (Date.now() - new Date(row.last_compliment_at).getTime()) / (60 * 60 * 1000);
      if (hoursSince < COOLDOWN_HOURS) return null;
    }

    const behavior = detectBehavior(text);
    if (!behavior) return null;

    if (Math.random() >= COMPLIMENT_CHANCE) return null;

    // Фиксируем момент комплимента сразу — модуль даёт лишь возможность
    // модели вплести комплимент, дальнейшее решение (сказать/не сказать) уже
    // на её стороне, но кулдаун должен работать от момента предоставления
    // подсказки, а не от факта её реального использования в тексте.
    await db.execute(
      `UPDATE peer_compliment_state SET last_compliment_at = NOW() WHERE account_id = ? AND peer_id = ?`,
      [accountId, String(peerId)],
    );

    return behavior.hint;
  } catch (err) {
    console.error(`[complimentEngine] Не удалось получить подсказку для комплимента ${accountId}/${peerId}:`, err.message);
    return null;
  }
}

module.exports = { getComplimentHint };
