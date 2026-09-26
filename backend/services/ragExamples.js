/**
 * RAG по корпусу диалогов day1 / day2.
 *
 * Хранит пары «реплика человека → эталонный ответ» в MySQL, один раз
 * считает embeddings (text-embedding-3-small) для реплик человека.
 * Перед ответом бота достаёт top-k похожих примеров того же дня диалога
 * и отдаёт текстовый сниппет в aiResponder (как learningSnippet).
 *
 * Если embeddings API недоступен — fallback на token-overlap scoring,
 * бот не падает.
 */

const crypto = require('crypto');
const db = require('../db');
const OpenAI = require('openai');
const { buildOpenAIOptions } = require('./aiResponder');

const RAG_ENABLED = process.env.RAG_ENABLED !== '0' && process.env.RAG_ENABLED !== 'false';
const EMBED_MODEL = process.env.RAG_EMBED_MODEL || 'text-embedding-3-small';
const TOP_K = Math.max(1, Math.min(8, Number(process.env.RAG_TOP_K) || 5));
const MIN_COSINE = Number(process.env.RAG_MIN_SCORE) || 0.35;
const MIN_TOKEN = Number(process.env.RAG_MIN_TOKEN_SCORE) || 0.15;

const embedClient = new OpenAI(buildOpenAIOptions());

let schemaReady = null;
/** @type {null | Map<number, Array<{id:number, client_message:string, bot_reply:string, embedding:number[]|null}>>} */
let corpusCache = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS rag_dialogue_examples (
        id INT AUTO_INCREMENT PRIMARY KEY,
        day TINYINT NOT NULL COMMENT '1 или 2',
        client_message TEXT NOT NULL,
        bot_reply TEXT NOT NULL,
        source VARCHAR(255) NULL,
        content_hash CHAR(40) NOT NULL,
        embedding MEDIUMTEXT NULL COMMENT 'JSON float[]',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_rag_hash_day (day, content_hash),
        KEY idx_rag_day (day)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  })().catch((err) => {
    schemaReady = null;
    console.error('[ragExamples] Не удалось создать таблицу:', err.message);
    throw err;
  });
  return schemaReady;
}

function invalidateCache() {
  corpusCache = null;
}

/**
 * Day 1: < 24ч, Day 2: >= 24ч (включая >48ч по плану).
 * null age → day 1 (новый/пустой диалог).
 */
function dialogDayFromAgeHours(ageHours) {
  if (ageHours == null || !Number.isFinite(ageHours)) return 1;
  if (ageHours < 24) return 1;
  return 2;
}

function contentHash(day, clientMessage, botReply) {
  return crypto
    .createHash('sha1')
    .update(`${day}\n${String(clientMessage).trim()}\n${String(botReply).trim()}`)
    .digest('hex');
}

function tokensOf(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 2);
}

function tokenScore(incoming, exampleClient) {
  const a = tokensOf(incoming);
  const b = tokensOf(exampleClient);
  if (!a.length || !b.length) return 0;
  const aJoined = a.join(' ');
  const bJoined = b.join(' ');
  if (aJoined.includes(bJoined) || bJoined.includes(aJoined)) return 1;
  const set = new Set(a);
  let hits = 0;
  for (const word of b) {
    if (set.has(word)) hits += 1;
  }
  return hits / b.length;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function parseEmbedding(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw.map(Number);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(Number) : null;
  } catch (_) {
    return null;
  }
}

async function embedText(text) {
  const input = String(text || '').trim().slice(0, 4000);
  if (!input) return null;
  try {
    const res = await embedClient.embeddings.create({
      model: EMBED_MODEL,
      input,
    });
    const vec = res?.data?.[0]?.embedding;
    return Array.isArray(vec) ? vec : null;
  } catch (err) {
    console.error('[ragExamples] embed failed:', err.message);
    return null;
  }
}

async function loadCorpus(day) {
  await ensureSchema();
  if (!corpusCache) {
    corpusCache = new Map();
  }
  if (corpusCache.has(day)) {
    return corpusCache.get(day);
  }

  const [rows] = await db.execute(
    `SELECT id, day, client_message, bot_reply, embedding
     FROM rag_dialogue_examples
     WHERE day = ?
     ORDER BY id ASC`,
    [day],
  );

  const items = (rows || []).map((row) => ({
    id: Number(row.id),
    client_message: String(row.client_message || ''),
    bot_reply: String(row.bot_reply || ''),
    embedding: parseEmbedding(row.embedding),
  }));
  corpusCache.set(day, items);
  return items;
}

/**
 * Top-k похожих примеров для дня.
 * @returns {Promise<Array<{id:number, client_message:string, bot_reply:string, score:number, method:string}>>}
 */
async function retrieveSimilar(day, incomingText, limit = TOP_K) {
  if (!RAG_ENABLED) return [];
  const text = String(incomingText || '').trim();
  if (!text) return [];

  let corpus;
  try {
    corpus = await loadCorpus(day);
  } catch (err) {
    console.error('[ragExamples] loadCorpus:', err.message);
    return [];
  }
  if (!corpus.length) return [];

  const queryEmbed = await embedText(text);
  const scored = [];

  if (queryEmbed) {
    for (const item of corpus) {
      if (!item.embedding) continue;
      const score = cosineSimilarity(queryEmbed, item.embedding);
      if (score >= MIN_COSINE) {
        scored.push({ ...item, score, method: 'embed' });
      }
    }
  }

  // Fallback / дополнение token-score, если эмбеддингов мало или API упал.
  if (scored.length < limit) {
    const used = new Set(scored.map((s) => s.id));
    for (const item of corpus) {
      if (used.has(item.id)) continue;
      const score = tokenScore(text, item.client_message);
      if (score >= MIN_TOKEN) {
        scored.push({ ...item, score, method: 'token' });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ id, client_message, bot_reply, score, method }) => ({
    id,
    client_message,
    bot_reply,
    score,
    method,
  }));
}

/**
 * Текстовый блок для system-промпта.
 */
async function buildRagSnippet(day, incomingText) {
  if (!RAG_ENABLED) return '';
  try {
    const hits = await retrieveSimilar(day, incomingText, TOP_K);
    if (!hits.length) return '';

    let snippet = `\n\n=== ПРИМЕРЫ ИЗ КОРПУСА (day ${day}) ===\n`;
    snippet +=
      'Это эталонные ответы из похожих диалогов того же дня знакомства. ' +
      'Если реплика собеседника близка по смыслу — бери тон, длину и структуру ответа. ' +
      'НЕ копируй дословно. Учитывай запрет личных встреч и гео-консистентность из других правил. ' +
      'НЕ копируй отказ «давай тут общаться» / «мне так удобнее», если собеседник НЕ просил контакты и НЕ звал на встречу. ' +
      'Если он спрашивает про твою работу — ты занимаешься флипингом цифровых токенов; не бери профессию из примеров и не уходи в «разбираться в людях».\n\n';

    for (const hit of hits) {
      const client = String(hit.client_message || '').slice(0, 200);
      const bot = String(hit.bot_reply || '').slice(0, 240);
      snippet += `Собеседник: «${client}»\nЭталон: «${bot}»\n\n`;
    }
    return snippet;
  } catch (err) {
    console.error('[ragExamples] buildRagSnippet:', err.message);
    return '';
  }
}

/**
 * Вставка/обновление одной пары. embedding можно передать готовый или посчитать.
 */
async function upsertExample({
  day,
  clientMessage,
  botReply,
  source = null,
  embedding = null,
  skipEmbed = false,
}) {
  await ensureSchema();
  const d = Number(day) === 2 ? 2 : 1;
  const client = String(clientMessage || '').trim();
  const bot = String(botReply || '').trim();
  if (!client || !bot) {
    throw new Error('client_message and bot_reply required');
  }

  const hash = contentHash(d, client, bot);
  let vec = embedding;
  if (!vec && !skipEmbed) {
    vec = await embedText(client);
  }
  const embeddingJson = vec ? JSON.stringify(vec) : null;

  await db.execute(
    `INSERT INTO rag_dialogue_examples
       (day, client_message, bot_reply, source, content_hash, embedding)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       client_message = VALUES(client_message),
       bot_reply = VALUES(bot_reply),
       source = VALUES(source),
       embedding = COALESCE(VALUES(embedding), embedding)`,
    [d, client, bot, source, hash, embeddingJson],
  );
  invalidateCache();
  return { day: d, content_hash: hash, has_embedding: Boolean(vec) };
}

/**
 * Досчитать embeddings для строк без вектора.
 */
async function backfillEmbeddings({ limit = 200, delayMs = 50 } = {}) {
  await ensureSchema();
  const [rows] = await db.execute(
    `SELECT id, client_message FROM rag_dialogue_examples
     WHERE embedding IS NULL
     ORDER BY id ASC
     LIMIT ?`,
    [limit],
  );

  let done = 0;
  let failed = 0;
  for (const row of rows) {
    const vec = await embedText(row.client_message);
    if (!vec) {
      failed += 1;
      continue;
    }
    await db.execute(`UPDATE rag_dialogue_examples SET embedding = ? WHERE id = ?`, [
      JSON.stringify(vec),
      row.id,
    ]);
    done += 1;
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  if (done) invalidateCache();
  return { done, failed, remaining_checked: rows.length };
}

async function countByDay() {
  await ensureSchema();
  const [rows] = await db.execute(
    `SELECT day, COUNT(*) AS n,
            SUM(embedding IS NOT NULL) AS with_embed
     FROM rag_dialogue_examples
     GROUP BY day
     ORDER BY day`,
  );
  return rows;
}

module.exports = {
  RAG_ENABLED,
  ensureSchema,
  dialogDayFromAgeHours,
  buildRagSnippet,
  retrieveSimilar,
  upsertExample,
  backfillEmbeddings,
  countByDay,
  invalidateCache,
  embedText,
  contentHash,
};
