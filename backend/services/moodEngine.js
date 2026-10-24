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
  energetic:
    'НАСТРОЕНИЕ СЕЙЧАС — бодрое: пиши живо, залюбленно и тепло, 1–2 короткие фразы ок. ' +
    'Можно лёгкую инициативу (один живой вопрос или короткий подкол к месту) — но не каждый ответ вопросом. ' +
    'Без прилипчивой «любви»; эмодзи-смайл — редко (один мягкий в конце).',
  neutral:
    'НАСТРОЕНИЕ СЕЙЧАС — ровное (посередине): тепло + лёгкая нежность + подкол где уместно. ' +
    'Обычная длина: одна короткая фраза, иногда две. Вопрос в конце — редко. ' +
    'Эмодзи не спамь — максимум один мягкий смайл иногда.',
  tired:
    'НАСТРОЕНИЕ СЕЙЧАС — усталое: отвечай КОРОЧЕ обычного (часто 2–6 слов), мягко и по-домашнему. ' +
    'Можно один раз обмолвиться про усталость. Без вопросов в конце, без эмодзи, без инициативы; ласка — тихо, если к месту.',
  excited:
    'НАСТРОЕНИЕ СЕЙЧАС — приподнятое: теплее и залюбленнее обычного, но без «!!!» и без приторности. ' +
    'Можно чуть длиннее (до 2 коротких фраз) и один лёгкий вопрос/реакция. Редко один мягкий смайл ☺️/🥰.',
};

/** Граница слова с кириллицей: JS `\b` не работает с русским. */
function ruBound(inner) {
  return new RegExp(`(?:^|[^а-яёa-z0-9_])(?:${inner})(?![а-яёa-z0-9_])`, 'i');
}

const FLASH_EMOTIONS = {
  hurt: {
    re: ruBound('дура|дур[ае]|туп(?:ая|ое)|заткнись|ненавижу|пошла\\s+на|отвали|уродина|мраз|сука|блять\\s+ты|иди\\s+нах'),
    ttlMin: [20, 45],
    cooldownMin: 180,
    chance: 0.85,
    hint:
      'КОРОТКАЯ ЭМОЦИЯ — задетость: он задел/грубо. Отвечай короче и чуть холоднее обычного, без истерики и без «я обиделась» прямым текстом. Можно одна сухая фраза. Не устраивай разбор полётов.',
  },
  amused: {
    // «хах»/«ахах» само по себе — часто смешок-согласие, а не шутка.
    // Ловим настоящий смех или явную шутку, чтобы бот не выдумывал юмор.
    re: /(ахаха|хахаха|прикол|ржу|смешно|😂|🤣|(^|\s)лол(\s|$)|кек(?![а-яё])|насмешил|рассмешил)/i,
    ttlMin: [8, 25],
    cooldownMin: 60,
    chance: 0.55,
    hint:
      'КОРОТКАЯ ЭМОЦИЯ — смех: ему смешно / он пошутил. Можно коротко отзеркалить веселье («ахах», лёгкая шутка), без стендапа и без эмодзи-спама. ' +
      'НЕ утверждай, что он что-то сказал смешное, если в его сообщении шутки нет — он может спросить «где я шутил?».',
  },
  warm: {
    re: ruBound('нравишься|милая|красивая|люблю|ценю|спасибо\\s+тебе|ты\\s+класс|ты\\s+крутая|обнимаю|скучал|милый|хорошая|приятно\\s+с\\s+тобой'),
    ttlMin: [15, 40],
    cooldownMin: 90,
    chance: 0.65,
    hint:
      'КОРОТКАЯ ЭМОЦИЯ — тепло: он сказал что-то приятное. Ответь чуть теплее / любовнобильнее обычного ' +
      '(«ну ты милый)», «приятно)», «мне тоже ок с тобой)») — одна короткая фраза; без «я тебя люблю» и без прилипания.',
  },
  annoyed: {
    re: ruBound(
      'дай\\s+номер|скинь\\s+номер|го\\s+встретимся|секс|голая|сиськ|сисек|жоп|шлюх|сучк|хозяин|виртик|раздет|покажи\\s+грудь|интим|хочу\\s+тебя|фетиш',
    ),
    ttlMin: [12, 35],
    cooldownMin: 90,
    chance: 0.85,
    hint:
      'КОРОТКАЯ ЭМОЦИЯ — раздражение: он давит сексом/оскорбляет. Короче и суше, отказ без «извини» и без лекции. Не продолжай тему сама. Не называй его хозяином.',
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
  if (/[!]{2,}/.test(value) || ruBound('класс|супер|спасибо|молодец|нравишься|люблю|интересно').test(value)) return 10;
  if (ruBound('дура|бред|врань|скам|мошенн|заткнись|ненавижу').test(value)) return -15;
  return 2;
}

function styleHint(text, score) {
  const value = String(text || '');
  const words = value.trim().split(/\s+/).filter(Boolean).length;
  const emotional = /[!?]{2,}|[😂🤣❤️😍🔥😡🤬]/u.test(value);
  let lengthRule;
  let initiativeRule;
  let tone;
  if (score < 30) {
    tone = 'короче и суше обычного, но не грубо — тепло «посередине» без ласки';
    lengthRule = 'Длина: 2–7 слов. Без второго предложения.';
    initiativeRule = 'Без вопроса в конце и без «а ты?»';
  } else if (score > 70) {
    tone =
      'особенно залюбленно и тепло, с лёгким интересом; можно тихий подкол — без «я тебя люблю» и без прилипания';
    lengthRule = 'Длина: одна короткая фраза, иногда две.';
    initiativeRule = 'Можно один живой вопрос ИЛИ лёгкий подкол — не оба сразу. Редко один мягкий смайл.';
  } else {
    tone = 'тепло и залюбленно, с лёгким подколом где уместно — не приторно и не зло';
    lengthRule = 'Длина: одна короткая фраза; две — только если есть что сказать.';
    initiativeRule = 'Вопрос в конце — редко (не чаще чем раз в несколько реплик). Смайл-эмодзи — редко.';
  }
  const mirror = words <= 5 && !emotional
    ? 'Собеседник пишет сухо и коротко — отвечай ЕЩЁ короче, без эмодзи и без вопроса в конце.'
    : emotional
      ? 'Собеседник эмоционален — отрази тон коротко и теплее; если дразнит, можно лёгкий сарказм.'
      : 'Естественный тёплый тон; эмодзи — редко один мягкий.';
  return (
    `Настроение диалога: ${score}/100. Отвечай ${tone}. ${lengthRule} ${initiativeRule} ${mirror} ` +
    'Без эссе и без «поисковых» объяснений. Не объясняй этот анализ.'
  );
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
