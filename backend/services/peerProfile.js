/**
 * Лёгкий профиль собеседника (peer) для подсказок AI:
 * характер/стиль ДРУГОГО человека — summary + tags в MySQL,
 * иногда обновляется через gpt-4o-mini (раз в PEER_PROFILE_EVERY сообщений).
 */

const db = require('../db');
const OpenAI = require('openai');
const { buildOpenAIOptions, getAnalysisModel } = require('./aiResponder');

const PEER_PROFILE_EVERY = 8;
const MAX_HISTORY_TURNS = 12;
const MAX_OUT_TOKENS = 120;

const openai = new OpenAI(buildOpenAIOptions());

let schemaReady = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS peer_profiles (
        account_id INT NOT NULL,
        peer_id VARCHAR(64) NOT NULL,
        summary VARCHAR(500) NULL,
        tags VARCHAR(255) NULL,
        msg_count INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (account_id, peer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  })().catch((err) => {
    schemaReady = null;
    console.error('[peerProfile] Не удалось создать таблицу:', err.message);
    throw err;
  });
  return schemaReady;
}

/**
 * @returns {Promise<{ summary: string|null, tags: string|null, msg_count: number }|null>}
 */
async function getProfile(accountId, peerId) {
  try {
    await ensureSchema();
    const [[row]] = await db.execute(
      `SELECT summary, tags, msg_count FROM peer_profiles
       WHERE account_id = ? AND peer_id = ? LIMIT 1`,
      [accountId, String(peerId)],
    );
    if (!row) return null;
    return {
      summary: row.summary || null,
      tags: row.tags || null,
      msg_count: Number(row.msg_count) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Короткая русская подсказка для generateReply, или null если профиля нет.
 */
async function buildHint(accountId, peerId) {
  try {
    const profile = await getProfile(accountId, peerId);
    if (!profile) return null;
    const summary = String(profile.summary || '').trim();
    const tags = String(profile.tags || '').trim();
    if (!summary && !tags) return null;

    const parts = ['Профиль собеседника:'];
    if (summary) parts.push(summary);
    if (tags) parts.push(`Теги: ${tags}`);
    parts.push('Подстрой тон под него, не зеркаль вслух.');
    return parts.join(' ');
  } catch {
    return null;
  }
}

function clip(str, max) {
  const s = String(str || '').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function formatHistoryTurns(history, userMessage) {
  const turns = Array.isArray(history) ? history.slice(-MAX_HISTORY_TURNS) : [];
  const lines = [];
  for (const h of turns) {
    const role = String(h?.role || '').toLowerCase();
    const who = role === 'assistant' || role === 'bot' ? 'бот' : 'собеседник';
    const text = String(h?.content || h?.text || '').trim();
    if (!text) continue;
    lines.push(`${who}: ${clip(text, 280)}`);
  }
  const um = String(userMessage || '').trim();
  if (um) lines.push(`собеседник: ${clip(um, 280)}`);
  return lines.join('\n');
}

/**
 * Инкремент msg_count; каждые PEER_PROFILE_EVERY сообщений — дешёвый
 * апдейт summary/tags через gpt-4o-mini. Ошибки глотаем.
 */
async function maybeUpdate(accountId, peerId, history, userMessage) {
  try {
    await ensureSchema();
    const peer = String(peerId);

    const [[existing]] = await db.execute(
      `SELECT msg_count, summary, tags FROM peer_profiles
       WHERE account_id = ? AND peer_id = ? LIMIT 1`,
      [accountId, peer],
    );

    const msgCount = (existing?.msg_count || 0) + 1;

    await db.execute(
      `INSERT INTO peer_profiles (account_id, peer_id, summary, tags, msg_count, updated_at)
       VALUES (?, ?, NULL, NULL, 1, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE msg_count = ?, updated_at = CURRENT_TIMESTAMP`,
      [accountId, peer, msgCount],
    );

    if (msgCount % PEER_PROFILE_EVERY !== 0) return;

    const transcript = formatHistoryTurns(history, userMessage);
    if (!transcript) return;

    const completion = await openai.chat.completions.create({
      model: getAnalysisModel(),
      max_tokens: MAX_OUT_TOKENS,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Ты кратко описываешь ХАРАКТЕР и СТИЛЬ общения СОБЕСЕДНИКА (не бота) ' +
            'по фрагменту переписки. Ответь строго JSON: ' +
            '{"summary":"1-2 коротких предложения на русском о характере/тоне собеседника",' +
            '"tags":"через запятую 3-6 коротких тегов (напр. сухой, шутит, осторожный, прямолинейный)"}. ' +
            'Без выдумок фактов биографии. Только стиль общения.',
        },
        {
          role: 'user',
          content: transcript,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || '';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const summary = clip(parsed?.summary, 500);
    const tags = clip(
      Array.isArray(parsed?.tags) ? parsed.tags.join(', ') : parsed?.tags,
      255,
    );
    if (!summary && !tags) return;

    await db.execute(
      `UPDATE peer_profiles
       SET summary = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
       WHERE account_id = ? AND peer_id = ?`,
      [summary || null, tags || null, accountId, peer],
    );
  } catch {
    // silent
  }
}

module.exports = {
  ensureSchema,
  getProfile,
  buildHint,
  maybeUpdate,
  PEER_PROFILE_EVERY,
};
