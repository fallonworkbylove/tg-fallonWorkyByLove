/**
 * MEMORY TRIGGERS — факты о собеседнике + что бот уже рассказывала ему.
 *
 * О нём: питомец, работа, здоровье, город, хобби, планы, имя, предпочтения.
 * О себе в этом чате: имя, город, переезд, работа, мама — чтобы не «впервые»
 * рассказывать одно и то же.
 *
 * Follow-up: через 1–4 дня сама возвращается к факту в ответе или в дневной инициативе.
 */

const db = require('../db');

let schemaReady = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await db.execute(`
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
    await db.execute(`
      CREATE TABLE IF NOT EXISTS peer_self_told (
        id INT AUTO_INCREMENT PRIMARY KEY,
        account_id INT NOT NULL,
        peer_id VARCHAR(64) NOT NULL,
        fact_type VARCHAR(32) NOT NULL,
        fact_text VARCHAR(255) NOT NULL,
        created_at DATETIME NOT NULL,
        UNIQUE KEY uniq_self (account_id, peer_id, fact_type),
        INDEX idx_peer (account_id, peer_id)
      )
    `);
  })();
  return schemaReady;
}

const FACT_PATTERNS = [
  { type: 'pet', re: /(собак|кот[аеу]?\b|кошк|песик|щенок|корги|котен[оё]к|хомяк|попугай|питомец)/i },
  { type: 'health', re: /(заболел|болею|температура|простыл|больниц|врач|таблетк|плохо себя чувству|температур|кашля)/i },
  { type: 'work', re: /(на работе|уволил|начальник|коллег|смена сегодня|устал[а]? на работе|устрои(лся|лась) на работу|я\s+(барбер|дизайнер|водитель|программист|врач|повар|строитель|менеджер|фотограф|музыкант|учитель|студент)|работаю\s+(как\s+)?[а-яёa-z]{3,})/i },
  { type: 'city', re: /(живу в|я из |переехал[а]? в|у нас в городе)/i },
  { type: 'hobby', re: /(я\s+(играю|хожу|занимаюсь|люблю)\s+|хобби|в зал|в качалк|на рыбалк|в футбол|гитар|фотограф\w* как хобби)/i },
  { type: 'plans', re: /(завтра\s+(иду|поеду|буду|работаю)|на выходн|в субботу|в воскресенье|собираюсь\s+(пойти|поехать|вечером))/i },
  { type: 'name', re: /(?:меня зовут|мо[её]\s+имя|я\s+)\s*([А-ЯЁA-Z][а-яёa-z]{2,15})\b/ },
  { type: 'pref', re: /(не люблю|ненавижу|терпеть не могу|обожаю|кайфую от)\s+[а-яёa-z\s]{3,40}/i },
  { type: 'family', re: /(моя?\s+(мама|папа|брат|сестра|жена|девушка)|у меня\s+(мама|папа|брат|сестра))/i },
];

const SELF_PATTERNS = [
  { type: 'name', re: /меня зовут\s+([А-ЯЁа-яё]{2,20})/i, capture: true },
  { type: 'city', re: /(?:живу в|я в|сейчас в)\s+([А-ЯЁа-яё\-]{3,30})/i, capture: true },
  { type: 'move', re: /(переезжа\w+|собираю вещи|коробк\w+|к маме)/i, capture: false },
  { type: 'job', re: /(флип\w*|токен\w*|nft|цифров\w+\s+токен)/i, capture: false },
  { type: 'family', re: /(мама|маме|к маме)/i, capture: false },
];

function clipFact(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\[.*?\]/g, '')
    .trim()
    .slice(0, 255);
}

async function extractAndSaveFact(accountId, peerId, text) {
  if (!text || text.length < 2) return;
  // Не сохраняем описания его медиа как «факты».
  if (/\[(?:кружок|фото|видео)\s+от\s+собеседника\]/i.test(text)) return;
  try {
    let match = FACT_PATTERNS.find((p) => p.re.test(text));
    let factText = clipFact(text);

    if (!match) {
      const lines = String(text)
        .split('\n')
        .map((line) => line.replace(/\n\[Ответ на сообщение[^\]]*\]/gi, '').trim())
        .filter(Boolean);
      if (lines.length > 1) {
        const first = lines[0].replace(/[).!…]+$/g, '').trim();
        const restAsk = lines
          .slice(1)
          .some((line) => /[?]/.test(line) || /(откуда|знаешь|где|where|from)/i.test(line));
        if (
          restAsk &&
          first.length >= 2 &&
          first.length <= 40 &&
          !/[?]/.test(first) &&
          /^[А-ЯA-ZЁа-яёa-z]/.test(first)
        ) {
          match = { type: 'city' };
          factText = first.slice(0, 255);
        }
      }
    }

    if (!match) return;

    if (match.type === 'name') {
      const m = text.match(match.re);
      if (m && m[1]) factText = m[1].slice(0, 40);
    }

    await ensureSchema();

    const [[existing]] = await db.execute(
      `SELECT id FROM peer_memory_facts
       WHERE account_id = ? AND peer_id = ? AND fact_type = ?
         AND created_at > (NOW() - INTERVAL 7 DAY)
       LIMIT 1`,
      [accountId, String(peerId), match.type],
    );
    if (existing) return;

    await db.execute(
      `INSERT INTO peer_memory_facts (account_id, peer_id, fact_type, fact_text, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [accountId, String(peerId), match.type, factText],
    );
  } catch (err) {
    console.error('[memoryTriggers] Не удалось сохранить факт:', err.message);
  }
}

/** Запоминает, что бот уже рассказала этому человеку о себе. */
async function extractSelfTold(accountId, peerId, botText) {
  const text = String(botText || '').trim();
  if (!text || text.length < 4 || /^\[/.test(text)) return;
  try {
    await ensureSchema();
    for (const p of SELF_PATTERNS) {
      const m = text.match(p.re);
      if (!m) continue;
      const factText = p.capture && m[1]
        ? clipFact(m[1])
        : clipFact(m[0]);
      if (!factText) continue;
      await db.execute(
        `INSERT IGNORE INTO peer_self_told (account_id, peer_id, fact_type, fact_text, created_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [accountId, String(peerId), p.type, factText],
      );
    }
  } catch (err) {
    console.error('[memoryTriggers] Не удалось сохранить self-told:', err.message);
  }
}

const FOLLOW_UP_HINTS = {
  pet: (fact) =>
    `Ранее он упоминал питомца («${fact}»). Если уместно — вскользь спроси как питомец, коротко и по-дружески.`,
  health: (fact) =>
    `Ранее он говорил что болел/плохо («${fact}»). Если уместно — спроси как себя чувствует сейчас, коротко.`,
  work: (fact) =>
    `Ранее он говорил про работу («${fact}»). Если уместно — вскользь спроси как на работе, без давления.`,
  city: (fact) =>
    `Ранее он упоминал город («${fact}»). Можешь вскользь опереться на это, не переспрашивая как в первый раз.`,
  hobby: (fact) =>
    `Ранее он говорил про хобби («${fact}»). Если уместно — лёгкий вопрос или отсылка, коротко.`,
  plans: (fact) =>
    `Ранее у него были планы («${fact}»). Если уместно — спроси как прошло / получилось ли, коротко.`,
  name: (fact) =>
    `Его зовут ${fact}. Можешь иногда обращаться по имени, без навязчивости.`,
  pref: (fact) =>
    `Он говорил о предпочтении («${fact}»). Учитывай это, не спорь в лоб без нужды.`,
  family: (fact) =>
    `Он упоминал семью («${fact}»). Если уместно — мягкая отсылка, без допроса.`,
};

const POKE_PHRASES = {
  pet: (fact) => `кстати как там твой питомец)`,
  health: () => `ты как, получше уже?)`,
  work: () => `ну что как работа сегодня)`,
  city: () => `как у вас там погода)`,
  hobby: () => `ты чем сегодня занимался?)`,
  plans: () => `ну что, как планы?)`,
  family: () => `как ты там)`,
  name: (fact) => `${String(fact).split(/\s+/)[0]}, ты как там)`,
  pref: () => `ты как там)`,
};

async function getDueFollowUp(accountId, peerId) {
  try {
    await ensureSchema();
    const [[fact]] = await db.execute(
      `SELECT id, fact_type, fact_text FROM peer_memory_facts
       WHERE account_id = ? AND peer_id = ? AND followed_up_at IS NULL
         AND created_at <= (NOW() - INTERVAL 12 HOUR)
         AND created_at >= (NOW() - INTERVAL 4 DAY)
       ORDER BY created_at ASC LIMIT 1`,
      [accountId, String(peerId)],
    );
    if (!fact) return null;
    const buildHint = FOLLOW_UP_HINTS[fact.fact_type];
    if (!buildHint) return null;
    return { id: fact.id, type: fact.fact_type, hint: buildHint(fact.fact_text) };
  } catch (err) {
    console.error('[memoryTriggers] Не удалось проверить факты для напоминания:', err.message);
    return null;
  }
}

/**
 * Для дневной инициативы: готовая фраза по забытому факту, или null.
 */
async function pickMemoryPoke(accountId, peerId) {
  const due = await getDueFollowUp(accountId, peerId);
  if (!due) return null;
  const builder = POKE_PHRASES[due.type];
  if (!builder) return null;
  const [[row]] = await db.execute(
    `SELECT fact_text FROM peer_memory_facts WHERE id = ? LIMIT 1`,
    [due.id],
  ).catch(() => [[null]]);
  const phrase = builder(row?.fact_text || '');
  return { id: due.id, phrase };
}

async function markFollowedUp(factId) {
  try {
    await db.execute(`UPDATE peer_memory_facts SET followed_up_at = NOW() WHERE id = ?`, [factId]);
  } catch (err) {
    console.error('[memoryTriggers] Не удалось отметить факт как использованный:', err.message);
  }
}

const TYPE_LABELS = {
  pet: 'питомец',
  health: 'здоровье',
  work: 'работа',
  city: 'город',
  hobby: 'хобби',
  plans: 'планы',
  name: 'имя',
  pref: 'предпочтения',
  family: 'семья',
  move: 'переезд',
  job: 'её работа',
};

/**
 * Короткая шпаргалка в промпт: что знаем о нём и что уже говорили о себе.
 */
async function buildMemoryContextHint(accountId, peerId) {
  try {
    await ensureSchema();
    const [aboutHim] = await db.execute(
      `SELECT fact_type, fact_text FROM peer_memory_facts
       WHERE account_id = ? AND peer_id = ?
         AND created_at > (NOW() - INTERVAL 30 DAY)
       ORDER BY id DESC LIMIT 8`,
      [accountId, String(peerId)],
    );
    const [aboutSelf] = await db.execute(
      `SELECT fact_type, fact_text FROM peer_self_told
       WHERE account_id = ? AND peer_id = ?
         AND created_at > (NOW() - INTERVAL 30 DAY)
       ORDER BY id DESC LIMIT 8`,
      [accountId, String(peerId)],
    );
    if (!aboutHim.length && !aboutSelf.length) return null;

    const lines = [];
    if (aboutHim.length) {
      lines.push(
        'ПАМЯТЬ о нём (уже знаешь, не переспрашивай как в первый раз): ' +
          aboutHim
            .map((f) => `${TYPE_LABELS[f.fact_type] || f.fact_type}: «${String(f.fact_text).slice(0, 60)}»`)
            .join('; '),
      );
    }
    if (aboutSelf.length) {
      lines.push(
        'Ты УЖЕ рассказывала ему о себе (не подавай как новость снова): ' +
          aboutSelf
            .map((f) => `${TYPE_LABELS[f.fact_type] || f.fact_type}: «${String(f.fact_text).slice(0, 50)}»`)
            .join('; '),
      );
    }
    return lines.join('\n');
  } catch (err) {
    console.error('[memoryTriggers] Не удалось собрать memory context:', err.message);
    return null;
  }
}

module.exports = {
  extractAndSaveFact,
  extractSelfTold,
  getDueFollowUp,
  pickMemoryPoke,
  markFollowedUp,
  buildMemoryContextHint,
};
