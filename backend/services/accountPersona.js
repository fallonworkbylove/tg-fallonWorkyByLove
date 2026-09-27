/**
 * ACCOUNT PERSONA — у каждого номера свой характер (3–5 черт) и словарь речи.
 *
 * Черты стабильны для аккаунта (детерминированно от id, можно перезаписать в БД).
 * Подмешиваются в generateReply как system-hint, чтобы Кира ≠ Кристина ≠ Мила
 * только промптом имени.
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
];

const FILLER_SETS = [
  ['ну ', 'хм, ', 'короче '],
  ['эм, ', 'типа ', 'ну '],
  ['хм, ', 'ну ', 'ой '],
  ['короче ', 'ну ', 'да '],
];

const SMILE_SETS = [
  [')', '))', ''],
  [')', '', ')'],
  [')', 'ахах', '))'],
];

const LENGTH_HINTS = {
  short: 'Пиши чуть короче обычного (часто 3–8 слов).',
  medium: 'Обычная длина: одна короткая фраза, иногда две.',
  chatty: 'Можешь чуть разговорнее, но всё равно без абзацев — максимум 2 коротких предложения.',
};

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

function generatePersona(accountId) {
  const rand = mulberry32(hashSeed(accountId));
  const pool = [...TRAIT_POOL];
  const traits = [];
  const count = 3 + Math.floor(rand() * 3); // 3..5
  for (let i = 0; i < count && pool.length; i += 1) {
    const idx = Math.floor(rand() * pool.length);
    traits.push(pool.splice(idx, 1)[0]);
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
      persona = {
        traits: JSON.parse(row.traits_json),
        vocab: JSON.parse(row.vocab_json),
      };
    } else {
      persona = generatePersona(accountId);
      await db.execute(
        `INSERT INTO account_persona (account_id, traits_json, vocab_json, updated_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE traits_json = VALUES(traits_json)`,
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
  const smiles = (persona.vocab?.smiles || []).filter((s) => s !== undefined).map((s) => (s === '' ? 'без скобки' : s)).join('/');
  const lengthHint = LENGTH_HINTS[persona.vocab?.length] || LENGTH_HINTS.medium;
  return (
    `ХАРАКТЕР этого аккаунта (держись его стабильно): ${traitLine} ` +
    `${lengthHint} ` +
    (fillers ? `Из слов-паразитов ближе к: ${fillers} (редко, не каждый ответ). ` : '') +
    (smiles ? `Улыбки/концовки ближе к: ${smiles}. ` : '') +
    'Не объясняй свой характер собеседнику.'
  );
}

module.exports = {
  getPersona,
  buildPersonaHint,
  generatePersona,
};
