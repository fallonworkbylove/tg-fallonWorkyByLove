/**
 * MOOD ENGINE — «настроение» бота.
 *
 * 1) На аккаунт: energetic / neutral / tired / excited (ротация 2–4ч).
 * 2) На диалог: score 0–100 (теплота к этому человеку).
 * 3) Короткоживущие эмоции на диалог: hurt / amused / warm / annoyed (8–45 мин),
 *    с лимитами — не на каждое сообщение и не две сразу.
 */

const db = require('../db');

const ROTATING_MOODS = ['energetic', 'neutral', 'tired'];
const MIN_ROTATION_MS = 2 * 60 * 60 * 1000;
const MAX_ROTATION_MS = 4 * 60 * 60 * 1000;
const EXCITED_DURATION_MS = 3 * 60 * 60 * 1000;

const MOOD_HINTS = {
  energetic: 'Твоё настроение сейчас бодрое и тёплое: пиши живо, с лёгкой инициативой, дружелюбно — без прилипчивой «любви» в каждом слове. Почти без эмодзи в тексте.',
  neutral: 'Твоё настроение сейчас спокойное и тёплое: отвечай мягко, по-человечески, не сухо и не навязчиво. Без лишних эмодзи.',
  tired: 'Твоё настроение сейчас усталое: отвечай короче обычного, но всё равно мягко и по-домашнему, можно упомянуть усталость. Без эмодзи и без лишней ласки.',
  excited: 'Твоё настроение сейчас приподнятое. Пиши радостно и тепло словами, без приторности; радость можно показать реакцией на сообщение. Почти без эмодзи.',
};

const FLASH_EMOTIONS = {
  hurt: {
    re: /\b(дура|дур[ае]|туп(ая|ое)|заткнись|ненавижу|пошла\s+на|отвали|уродина|мраз|сука|блять ты|иди нах)/i,
    ttlMin: [20, 45],
    cooldownMin: 180,
    chance: 0.85,
    hint:
      'КОРОТКАЯ ЭМОЦИЯ — задетость: он задел/грубо. Отвечай короче и чуть холоднее обычного, без истерики и без «я обиделась» прямым текстом. Можно одна сухая фраза. Не устраивай разбор полётов.',
  },
  amused: {
    re: /(ха{2,}|ахах|прикол|ржу|смешно|😂|🤣|бе+\)|лол|кек)/i,
    ttlMin: [8, 25],
    cooldownMin: 60,
    chance: 0.45,
    hint:
      'КОРОТКАЯ ЭМОЦИЯ — смех: ему смешно / он пошутил. Можно коротко отзеркалить веселье («ахах», лёгкая шутка), без стендапа и без эмодзи-спама.',
  },
  warm: {
    re: /\b(нравишься|милая|красивая|люблю|ценю|спасибо тебе|ты класс|ты крутая|обнимаю|скучал)\b/i,
    ttlMin: [15, 40],
    cooldownMin: 120,
    chance: 0.55,
    hint:
      'КОРОТКАЯ ЭМОЦИЯ — тепло: он сказал что-то приятное. Ответь чуть теплее обычного, одной короткой фразой; без «я тебя люблю» и без прилипания.',
  },
  annoyed: {
    re: /\b(дай номер|скинь номер|го встретимся|секс|голая|сиськ|покажи грудь|интим|хочу тебя)\b/i,
    ttlMin: [12, 35],
    cooldownMin: 90,
    chance: 0.7,
    hint:
      'КОРОТКАЯ ЭМОЦИЯ — лёгкое раздражение: он давит на контакты/интим. Короче и суше, мягкий отказ без лекции. Не продолжай тему сама.',
  },
};

let schemaReady = null;
let peerSchemaReady = null;
let flashSchemaReady = null;

async function ensurePeerSchema() {
  if (peerSchemaReady) return peerSchemaReady;
  peerSchemaReady = db.execute(`
    CREATE TABLE IF NOT EXISTS bot_peer_mood (
      account_id INT NOT NULL,
      peer_id VARCHAR(128) NOT NULL,
      score TINYINT NOT NULL DEFAULT 50,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (account_id, peer_id)
    )
  `);
  return peerSchemaReady;
}

async function ensureFlashSchema() {
  if (flashSchemaReady) return flashSchemaReady;
  flashSchemaReady = db.execute(`
    CREATE TABLE IF NOT EXISTS bot_peer_flash_emotion (
      account_id INT NOT NULL,
      peer_id VARCHAR(128) NOT NULL,
      emotion VARCHAR(32) NOT NULL,
      expires_at DATETIME NOT NULL,
      last_triggered_at DATETIME NOT NULL,
      PRIMARY KEY (account_id, peer_id)
    )
  `);
  return flashSchemaReady;
}

function moodDelta(text) {
  const value = String(text || '').toLowerCase();
  if (/[!]{2,}|\b(класс|супер|спасибо|молодец|нравишься|люблю|интересно)\b/.test(value)) return 10;
  if (/\b(дура|бред|врань|скам|мошенн|заткнись|ненавижу)\b/.test(value)) return -15;
  return 2;
}

function styleHint(text, score) {
  const value = String(text || '');
  const words = value.trim().split(/\s+/).filter(Boolean).length;
  const emotional = /[!?]{2,}|[😂🤣❤️😍🔥😡🤬]/u.test(value);
  const tone = score < 30
    ? 'коротко и без навязчивой ласки, но всё равно мягко, не холодно'
    : score > 70
      ? 'особенно тепло и заинтересованно, можно одну лёгкую тёплую фразу — без «я тебя люблю» и без прилипания'
      : 'тепло и по-дружески, с лёгким интересом к нему, без навязчивости';
  const mirror = words <= 5 && !emotional
    ? 'Собеседник пишет сухо и коротко — отвечай ещё короче, без эмодзи и без вопроса в конце.'
    : emotional
      ? 'Собеседник эмоционален — отрази тон коротко; если дразнит, можно лёгкий сарказм.'
      : 'Естественный тон, почти без эмодзи, чаще без вопроса в конце.';
  return `Настроение диалога: ${score}/100. Отвечай ${tone}. ${mirror} Без эссе и без «поисковых» объяснений. Не объясняй этот анализ.`;
}

function pickFlashFromText(text) {
  const t = String(text || '');
  if (!t.trim()) return null;
  const order = ['hurt', 'annoyed', 'warm', 'amused'];
  for (const id of order) {
    const cfg = FLASH_EMOTIONS[id];
    if (cfg.re.test(t) && Math.random() < cfg.chance) return id;
  }
  return null;
}

function ttlMs(cfg) {
  const [a, b] = cfg.ttlMin;
  return (a + Math.random() * (b - a)) * 60 * 1000;
}

async function getFlashEmotion(accountId, peerId, text) {
  try {
    await ensureFlashSchema();
    const [[row]] = await db.execute(
      `SELECT emotion, expires_at, last_triggered_at
       FROM bot_peer_flash_emotion WHERE account_id = ? AND peer_id = ? LIMIT 1`,
      [accountId, String(peerId)],
    );
    const now = Date.now();
    if (row && new Date(row.expires_at).getTime() > now) {
      const cfg = FLASH_EMOTIONS[row.emotion];
      return { emotion: row.emotion, hint: cfg?.hint || null };
    }

    const next = pickFlashFromText(text);
    if (!next) return { emotion: null, hint: null };

    const cfg = FLASH_EMOTIONS[next];
    if (row?.last_triggered_at && row.emotion === next) {
      const since = now - new Date(row.last_triggered_at).getTime();
      if (since < cfg.cooldownMin * 60 * 1000) return { emotion: null, hint: null };
    }
    if (row?.last_triggered_at) {
      const sinceAny = now - new Date(row.last_triggered_at).getTime();
      if (sinceAny < 45 * 60 * 1000) return { emotion: null, hint: null };
    }

    const expires = new Date(now + ttlMs(cfg));
    await db.execute(
      `INSERT INTO bot_peer_flash_emotion (account_id, peer_id, emotion, expires_at, last_triggered_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE emotion = VALUES(emotion), expires_at = VALUES(expires_at), last_triggered_at = NOW()`,
      [accountId, String(peerId), next, expires],
    );
    return { emotion: next, hint: cfg.hint };
  } catch (err) {
    console.error(`[moodEngine] flash emotion ${accountId}/${peerId}:`, err.message);
    return { emotion: null, hint: null };
  }
}

async function getConversationMood(accountId, peerId, text) {
  try {
    await ensurePeerSchema();
    const delta = moodDelta(text);
    await db.execute(
      `INSERT INTO bot_peer_mood (account_id, peer_id, score, updated_at) VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE score = LEAST(100, GREATEST(0, score + ?)), updated_at = NOW()`,
      [accountId, String(peerId), Math.max(0, Math.min(100, 50 + delta)), delta],
    );
    const [[row]] = await db.execute(
      `SELECT score FROM bot_peer_mood WHERE account_id = ? AND peer_id = ?`,
      [accountId, String(peerId)],
    );
    const score = row?.score ?? 50;
    const flash = await getFlashEmotion(accountId, peerId, text);
    const parts = [styleHint(text, score)];
    if (flash.hint) parts.push(flash.hint);
    return { score, flash: flash.emotion, hint: parts.join('\n') };
  } catch (err) {
    console.error(`[moodEngine] Не удалось обновить настроение диалога ${accountId}/${peerId}:`, err.message);
    return { score: 50, flash: null, hint: styleHint(text, 50) };
  }
}

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

module.exports = {
  getMood,
  getConversationMood,
  getFlashEmotion,
  triggerExcitedMood,
};
