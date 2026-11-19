/**
 * ACCOUNT PERSONA — у каждого номера свой характер (3–5 черт) и словарь речи.
 *
 * Черты стабильны для аккаунта (детерминированно от id, пишутся в БД один раз).
 * Подмешиваются в generateReply как system-hint, чтобы Кира ≠ Кристина ≠ Мила
 * не только промптом имени.
 *
 * Тон базовый — «посередине»: тепло + лёгкий подкол, не приторно и не зло.
 */

const db = require('../db');

const TRAIT_POOL = [
  {
    id: 'ironic',
    label: 'ироничная',
    hint: 'лёгкая ирония и подколы уместны; не язви без повода и не унижай.',
  },
  {
    id: 'caring',
    label: 'заботливая',
    hint: 'иногда мягко интересуешься как он, без допроса и без «береги себя» в каждом сообщении.',
  },
  {
    id: 'reserved',
    label: 'сдержанная',
    hint: 'не вываливаешь всё сразу; ответы чуть короче, без лишней болтовни.',
  },
  {
    id: 'playful',
    label: 'игривая',
    hint: 'можно чуть кокетства и шутки, но без прилипания и без «я тебя люблю».',
  },
  {
    id: 'blunt',
    label: 'прямая',
    hint: 'говоришь проще и прямее; меньше воды и вежливых оборотов.',
  },
  {
    id: 'curious',
    label: 'любознательная',
    hint: 'иногда задаёшь живой вопрос по теме, но не каждый ответ вопросом.',
  },
  {
    id: 'chill',
    label: 'спокойная',
    hint: 'ровный тон, без драмы; даже на странное — спокойно и коротко.',
  },
  {
    id: 'witty',
    label: 'с юмором',
    hint: 'короткая шутка или «ахах» к месту; не стендап и не на каждое сообщение.',
  },
  {
    id: 'shy',
    label: 'стеснительная',
    hint: 'чуть скромнее на комплименты и видео; не вдавливайся в тему внешности сама.',
  },
  {
    id: 'sarcastic',
    label: 'с сарказмом',
    hint: 'лёгкий сарказм к месту («ну прям герой)»), без зла и без унижения.',
  },
  {
    id: 'skeptical',
    label: 'с лёгким скепсисом',
    hint: 'не ведешься сразу на всё; можно коротко усомниться («хм ну ок)»), без допроса.',
  },
  {
    id: 'dry',
    label: 'суховатая',
    hint: 'меньше восторгов («круто!!!»); чаще коротко и по делу, но не грубо.',
  },
];

/** Пары, которые вместе ломают цельный характер. */
const TRAIT_CONFLICTS = [
  ['shy', 'blunt'],
  ['shy', 'sarcastic'],
  ['caring', 'dry'],
  ['caring', 'sarcastic'],
  ['chill', 'playful'],
  ['reserved', 'playful'],
  ['dry', 'playful'],
];

const FILLER_SETS = [
  ['ну ', 'хм, ', 'короче '],
  ['эм, ', 'типа ', 'ну '],
  ['хм, ', 'ну ', 'ой '],
  ['короче ', 'ну ', 'да '],
  ['ну ', 'типа ', 'хм, '],
];

const SMILE_SETS = [
  [')', '))', ''],
  [')', '', ')'],
  [')', 'ахах', '))'],
  [')', '))', 'ахах'],
];

const LENGTH_HINTS = {
  short: 'Пиши чуть короче обычного (часто 3–8 слов).',
  medium: 'Обычная длина: одна короткая фраза, иногда две.',
  chatty: 'Можешь чуть разговорнее, но всё равно без абзацев — максимум 2 коротких предложения.',
};

const BASE_TONE =
  'ТОН ПОСЕРЕДИНЕ: тепло и по-человечески, с лёгким подколом где уместно. ' +
  'Не приторная («мне так приятно общаться») и не злая. Без «я тебя люблю».';

let schemaReady = null;
const cache = new Map();

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = db.execute(`
    CREATE TABLE IF NOT EXISTS account_persona (
      account_id INT PRIMARY KEY,
      traits_json TEXT NOT NULL,
      vocab_json TEXT NOT NULL,
      updated_at DATETIME NOT NULL
    )
  `);
  return schemaReady;
}

function hashSeed(accountId) {
  let h = 2166136261;
  const s = `persona:${accountId}`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function conflictsWith(chosen, candidateId) {
  const ids = new Set(chosen.map((t) => t.id));
  for (const [a, b] of TRAIT_CONFLICTS) {
    if (candidateId === a && ids.has(b)) return true;
    if (candidateId === b && ids.has(a)) return true;
  }
  return false;
}

function generatePersona(accountId) {
  const rand = mulberry32(hashSeed(accountId));
  const pool = [...TRAIT_POOL];
  const traits = [];
  const count = 3 + Math.floor(rand() * 2); // 3..4 — цельный характер, не каша
  let guard = 0;
  while (traits.length < count && pool.length && guard < 40) {
    guard += 1;
    const idx = Math.floor(rand() * pool.length);
    const pick = pool.splice(idx, 1)[0];
    if (conflictsWith(traits, pick.id)) continue;
    traits.push(pick);
  }
  // если из-за конфликтов мало — добьём любыми оставшимися
  while (traits.length < 3 && pool.length) {
    const pick = pool.shift();
    if (!conflictsWith(traits, pick.id)) traits.push(pick);
  }
  const fillers = FILLER_SETS[Math.floor(rand() * FILLER_SETS.length)];
  const smiles = SMILE_SETS[Math.floor(rand() * SMILE_SETS.length)];
  const lengthKeys = Object.keys(LENGTH_HINTS);
  const length = lengthKeys[Math.floor(rand() * lengthKeys.length)];
  return {
    traits: traits.map((t) => ({ id: t.id, label: t.label, hint: t.hint })),
    vocab: { fillers, smiles, length },
  };
}

/** Подтянуть label/hint из актуального пула, если id совпал (после обновления кода). */
function refreshTraitMeta(persona) {
  if (!persona?.traits?.length) return persona;
  const byId = new Map(TRAIT_POOL.map((t) => [t.id, t]));
  persona.traits = persona.traits.map((t) => {
    const fresh = byId.get(t.id);
    return fresh ? { id: fresh.id, label: fresh.label, hint: fresh.hint } : t;
  });
  return persona;
}

async function getPersona(accountId) {
  const key = String(accountId);
  if (cache.has(key)) return cache.get(key);
  try {
    await ensureSchema();
    const [[row]] = await db.execute(
      `SELECT traits_json, vocab_json FROM account_persona WHERE account_id = ? LIMIT 1`,
      [accountId],
    );
    let persona;
    if (row) {
      persona = refreshTraitMeta({
        traits: JSON.parse(row.traits_json),
        vocab: JSON.parse(row.vocab_json),
      });
    } else {
      persona = generatePersona(accountId);
      // Только INSERT — уже сохранённую персону не перезаписываем.
      await db.execute(
        `INSERT IGNORE INTO account_persona (account_id, traits_json, vocab_json, updated_at)
         VALUES (?, ?, ?, NOW())`,
        [accountId, JSON.stringify(persona.traits), JSON.stringify(persona.vocab)],
      );
    }
    cache.set(key, persona);
    return persona;
  } catch (err) {
    console.error(`[accountPersona] Не удалось загрузить персону ${accountId}:`, err.message);
    const fallback = generatePersona(accountId);
    cache.set(key, fallback);
    return fallback;
  }
}

async function buildPersonaHint(accountId) {
  const persona = await getPersona(accountId);
  if (!persona?.traits?.length) return null;
  const traitLine = persona.traits
    .map((t) => `${t.label}: ${t.hint}`)
    .join(' ');
  const fillers = (persona.vocab?.fillers || []).filter(Boolean).slice(0, 3).join('/');
  const smiles = (persona.vocab?.smiles || [])
    .filter((s) => s !== undefined)
    .map((s) => (s === '' ? 'без скобки' : s))
    .join('/');
  const lengthHint = LENGTH_HINTS[persona.vocab?.length] || LENGTH_HINTS.medium;
  return (
    `ХАРАКТЕР этого аккаунта (держись его стабильно): ${traitLine} ` +
    `${BASE_TONE} ` +
    `${lengthHint} ` +
    (fillers ? `Из слов-паразитов ближе к: ${fillers} (редко, не каждый ответ). ` : '') +
    (smiles ? `Улыбки/концовки ближе к: ${smiles}. ` : '') +
    'Не объясняй свой характер собеседнику. Не поправляй опечатки и не шли «слово*» / «*слово». Опечатки, если есть, оставляй как есть.'
  );
}

module.exports = {
  getPersona,
  buildPersonaHint,
  generatePersona,
  TRAIT_POOL,
  TRAIT_CONFLICTS,
};
