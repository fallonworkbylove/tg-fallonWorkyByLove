/**
 * MEMORY TRIGGERS — бот запоминает факты о собеседнике (питомец, работа,
 * здоровье, город) и через 1-3 дня сам возвращается к ним:
 *   «как там твой корги, кстати)», «ты выздоровел?)»
 *
 * Извлечение фактов — простыми ключевыми словами (без лишних AI-запросов на
 * каждое сообщение). Храним в MySQL (та же БД, что и остальной проект).
 */

const db = require('../db');

let schemaReady = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = db.execute(`
    CREATE TABLE IF NOT EXISTS peer_memory_facts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      account_id INT NOT NULL,
      peer_id VARCHAR(64) NOT NULL,
      fact_type VARCHAR(32) NOT NULL,
      fact_text VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL,
      followed_up_at DATETIME NULL,
      INDEX idx_due (account_id, peer_id, followed_up_at, created_at)
    )
  `);
  return schemaReady;
}

// Ключевые слова -> тип факта. Порядок важен: первое совпадение побеждает.
const FACT_PATTERNS = [
  { type: 'pet', re: /(собак|кот[аеу]?\b|кошк|песик|щенок|корги|котен[оё]к|хомяк|попугай)/i },
  { type: 'health', re: /(заболел|болею|температура|простыл|больниц|врач|таблетк|плохо себя чувству|температур)/i },
  { type: 'work', re: /(на работе|уволил|начальник|коллег|смена сегодня|устал[а]? на работе|устрои(лся|лась) на работу)/i },
  { type: 'city', re: /(живу в|я из |переехал[а]? в|у нас в городе)/i },
];

/**
 * Пытается извлечь факт из входящего текста и сохранить его (не чаще одного
 * незакрытого факта того же типа за 7 дней на пару аккаунт+собеседник —
 * чтобы не плодить дубли и не напоминать про одно и то же по десять раз).
 */
async function extractAndSaveFact(accountId, peerId, text) {
  if (!text || text.length < 4) return;
  try {
    const match = FACT_PATTERNS.find((p) => p.re.test(text));
    if (!match) return;

    await ensureSchema();

    const [[existing]] = await db.execute(
      `SELECT id FROM peer_memory_facts
       WHERE account_id = ? AND peer_id = ? AND fact_type = ?
         AND created_at > (NOW() - INTERVAL 7 DAY)
       LIMIT 1`,
      [accountId, peerId, match.type],
    );
    if (existing) return;

    await db.execute(
      `INSERT INTO peer_memory_facts (account_id, peer_id, fact_type, fact_text, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [accountId, peerId, match.type, text.slice(0, 255)],
    );
  } catch (err) {
    console.error('[memoryTriggers] Не удалось сохранить факт:', err.message);
  }
}

const FOLLOW_UP_HINTS = {
  pet: (fact) =>
    `1-3 дня назад собеседник упоминал питомца (сказал: "${fact}"). Если это уместно по контексту, ` +
    'вскользь спроси про питомца, например в духе «как там твой corги, кстати)» — коротко и по-дружески, не в лоб.',
  health: (fact) =>
    `1-3 дня назад собеседник упоминал, что болеет/плохо себя чувствовал (сказал: "${fact}"). Если уместно, ` +
    'спроси, как он себя чувствует сейчас, например «ты выздоровел?)» — коротко и с заботой.',
  work: (fact) =>
    `1-3 дня назад собеседник упоминал что-то про работу (сказал: "${fact}"). Если уместно, вскользь спроси, ` +
    'как дела на работе сейчас — коротко, без давления.',
  city: (fact) =>
    `1-3 дня назад собеседник упоминал свой город (сказал: "${fact}"). Если уместно, можешь вскользь ` +
    'сослаться на это в разговоре.',
};

/**
 * Возвращает факт, к которому пора вернуться (создан 1-3 дня назад и ещё не
 * упоминался повторно), либо null.
 */
async function getDueFollowUp(accountId, peerId) {
  try {
    await ensureSchema();
    const [[fact]] = await db.execute(
      `SELECT id, fact_type, fact_text FROM peer_memory_facts
       WHERE account_id = ? AND peer_id = ? AND followed_up_at IS NULL
         AND created_at <= (NOW() - INTERVAL 1 DAY)
         AND created_at >= (NOW() - INTERVAL 3 DAY)
       ORDER BY created_at ASC LIMIT 1`,
      [accountId, peerId],
    );
    if (!fact) return null;
    const buildHint = FOLLOW_UP_HINTS[fact.fact_type];
    if (!buildHint) return null;
    return { id: fact.id, hint: buildHint(fact.fact_text) };
  } catch (err) {
    console.error('[memoryTriggers] Не удалось проверить факты для напоминания:', err.message);
    return null;
  }
}

/**
 * Отмечает факт как использованный в напоминании — чтобы не повторять его снова.
 */
async function markFollowedUp(factId) {
  try {
    await db.execute(`UPDATE peer_memory_facts SET followed_up_at = NOW() WHERE id = ?`, [factId]);
  } catch (err) {
    console.error('[memoryTriggers] Не удалось отметить факт как использованный:', err.message);
  }
}

module.exports = { extractAndSaveFact, getDueFollowUp, markFollowedUp };
