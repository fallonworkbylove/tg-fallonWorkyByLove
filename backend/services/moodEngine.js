/**
 * MOOD ENGINE — «настроение» бота (на аккаунт, не на конкретный диалог).
 *
 * 4 состояния: energetic, neutral, tired, excited.
 * - energetic / neutral / tired меняются случайно каждые 2-4 часа.
 * - excited не выбирается случайно — включается ТОЛЬКО явным вызовом
 *   triggerExcitedMood() (например, после «удачной сделки» в NFT-кампании)
 *   и держится ограниченное время, потом сама возвращается в обычную ротацию.
 */

const db = require('../db');

const ROTATING_MOODS = ['energetic', 'neutral', 'tired'];
const MIN_ROTATION_MS = 2 * 60 * 60 * 1000;
const MAX_ROTATION_MS = 4 * 60 * 60 * 1000;
const EXCITED_DURATION_MS = 3 * 60 * 60 * 1000; // «эйфория» держится ~3ч, потом обычная ротация

const MOOD_HINTS = {
  energetic: 'Твоё настроение сейчас бодрое и живое: пиши с инициативой, можно чуть больше эмодзи, легко продолжай тему.',
  neutral: 'Твоё настроение сейчас ровное, нейтральное: отвечай спокойно и по делу, без лишних эмоций.',
  tired: 'Твоё настроение сейчас усталое, вялое: отвечай короче обычного, без энтузиазма, можно упомянуть усталость (не навязчиво).',
  excited: 'Твоё настроение сейчас восторженное — только что удачно вышла сделка/сделка сыграла. Пиши радостно, с эмодзи, чуть более разговорчиво, можно поделиться радостью вскользь.',
};

let schemaReady = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = db.execute(`
    CREATE TABLE IF NOT EXISTS bot_mood (
      account_id INT PRIMARY KEY,
      mood VARCHAR(32) NOT NULL DEFAULT 'neutral',
      changed_at DATETIME NOT NULL,
      next_change_at DATETIME NOT NULL
    )
  `);
  return schemaReady;
}

function randomRotationMs() {
  return MIN_ROTATION_MS + Math.random() * (MAX_ROTATION_MS - MIN_ROTATION_MS);
}

function pickRotatingMood(exclude) {
  const options = ROTATING_MOODS.filter((m) => m !== exclude);
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * Возвращает текущее настроение аккаунта, вращая его при необходимости.
 * @returns {Promise<{mood: string, hint: string}>}
 */
async function getMood(accountId) {
  try {
    await ensureSchema();
    const [[row]] = await db.execute(
      `SELECT mood, changed_at, next_change_at FROM bot_mood WHERE account_id = ?`,
      [accountId],
    );

    const now = new Date();

    if (!row) {
      const mood = pickRotatingMood(null);
      const nextChangeAt = new Date(now.getTime() + randomRotationMs());
      await db.execute(
        `INSERT INTO bot_mood (account_id, mood, changed_at, next_change_at) VALUES (?, ?, NOW(), ?)`,
        [accountId, mood, nextChangeAt],
      );
      return { mood, hint: MOOD_HINTS[mood] };
    }

    if (now >= new Date(row.next_change_at)) {
      // excited не продлевается сам — по истечении срока возвращаемся в обычную ротацию.
      const mood = pickRotatingMood(row.mood === 'excited' ? null : row.mood);
      const nextChangeAt = new Date(now.getTime() + randomRotationMs());
      await db.execute(
        `UPDATE bot_mood SET mood = ?, changed_at = NOW(), next_change_at = ? WHERE account_id = ?`,
        [mood, nextChangeAt, accountId],
      );
      return { mood, hint: MOOD_HINTS[mood] };
    }

    return { mood: row.mood, hint: MOOD_HINTS[row.mood] || '' };
  } catch (err) {
    console.error(`[moodEngine] Не удалось получить настроение аккаунта ${accountId}:`, err.message);
    return { mood: 'neutral', hint: '' };
  }
}

/**
 * Включает «восторженное» настроение (например, после удачной NFT-сделки в
 * переписке). Держится EXCITED_DURATION_MS, потом сам вернётся в обычную
 * ротацию energetic/neutral/tired.
 */
async function triggerExcitedMood(accountId) {
  try {
    await ensureSchema();
    const nextChangeAt = new Date(Date.now() + EXCITED_DURATION_MS);
    await db.execute(
      `INSERT INTO bot_mood (account_id, mood, changed_at, next_change_at)
       VALUES (?, 'excited', NOW(), ?)
       ON DUPLICATE KEY UPDATE mood = 'excited', changed_at = NOW(), next_change_at = VALUES(next_change_at)`,
      [accountId, nextChangeAt],
    );
  } catch (err) {
    console.error(`[moodEngine] Не удалось включить excited для аккаунта ${accountId}:`, err.message);
  }
}

module.exports = { getMood, triggerExcitedMood };
