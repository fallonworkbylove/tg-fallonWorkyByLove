/**
 * humanHardening (0fz + 0ga + 0ge):
 * clone/pitch gates, phrase ban, peer tier, diary…
 * + #72/#73 bot-test/captcha, #48/#49 anti-anketa/lists,
 * #14 deferred text, #96 reason log, #100 score→tighten.
 * + persist interestHits / flip/pitch times across restart.
 */
const db = require('../db');
/** #41/#65 — «вторая такая / все одинаковые» */
const CLONE_SKEPTIC_RE =
  /втор(ая|ой)\s+девушк|уже\s+втор|такая\s+же|такие\s+же|одинаков|копипаст|все\s+вы|вы\s+все|все\s+девушк|как\s+под\s+копирк|ещё\s+одна\s+так|снова\s+так\s+же|скрипт|нейросет|ты\s+бот|наёб|развод|скам/i;

/** Явный интерес к флипу/токенам (#66) — только с контекстом флип/NFT/токен */
const EXPLICIT_FLIP_INTEREST_RE =
  /(?:расскажи|подробнее|интересно|покажи|что\s+за|как\s+(?:это\s+)?работа|хочу\s+(?:попробовать|узнать)|скинь\s+скрины?).{0,40}(?:флип|нфт|\bnft\b|токен|профит|перепрода)|(?:флип|нфт|\bnft\b|токен).{0,40}(?:как\s+работа|расскажи|подробнее|интересно|покажи|хочу)/i;

const NFT_PITCH_OUT_RE =
  /флип|нфт|\bnft\b|токен|перепрода|цифров\w*\s+токен|профит|вайтлист|whitelist/i;

const SELF_INTRO_RE =
  /я\s+(?:обычная\s+)?(?:девчонка|девушка)\s+из|занимаюсь\s+флип|работаю\s+(?:онлайн|удал[её]н)|флипинг\s+токен/i;

const APPEARANCE_ON_FOREIGN_MEDIA_RE =
  /борода\s+тебе|очки\s+тебе|тебе\s+к\s+лицу|красив(ая|ый)\s*\)?\s*$|милый\s+на\s+фото|ты\s+на\s+(?:фото|фотк|аватар)/i;

const BUSY_PEER_RE =
  /занят|на\s+работ|потом\s+напиш|давай\s+позже|не\s+когда|отбой|сплю|за\s+рул[её]м|на\s+встреч/i;

const RUDE_PEER_RE =
  /дур[ае]|идиот|сука|блять|пошл[ао]\s+нах|заткни|тупая|шлюх/i;

const BARE_OK_RE = /^(?:ну\s+|да\s+)?(?:ок|окей|ага|угу|ладно)\s*\)?\.?$/i;

const CONFUSED_TOPIC_RE =
  /(?:не\s+понял|не\s+поняла|в\s+смысле|о\s+ч[её]м\s+ты|ты\s+о\s+ч[её]м|что\s+ты\s+имеешь|какая\s+из)/i;

/** #72 — «докажи что живая / тест на бота» */
const BOT_TEST_RE =
  /докажи\s+что\s+(?:ты\s+)?(?:не\s+)?(?:жива|реальн|человек|бот)|тест\s+на\s+бот|проверь(?:ся|им)?\s+(?:что\s+)?(?:ты\s+)?(?:не\s+)?бот|ты\s+точно\s+(?:не\s+)?бот|напиши\s+что[- ]нибудь\s+чтобы\s+я\s+понял\s+что\s+ты\s+жива/i;

/** #73 — капча / математика / «переверни слово» */
const CAPTCHA_TEST_RE =
  /сколько\s+будет\s+\d|сколько\s+\d\s*[+\-*/×xх]\s*\d|\d\s*[+\-*/×xх]\s*\d\s*=|\bреши\s+(?:пример|задач)|переверни\s+(?:слово|текст)|напиши\s+задом\s+наперед|капч[аеу]|введи\s+код|что\s+на\s+картинке\s+капч/i;

const LATER_TEXT_PROMISE_RE =
  /(?:чуть\s+)?(?:позже|потом)\s+(?:напишу|отвечу|вернусь)|напишу\s+(?:чуть\s+)?(?:позже|потом)|сейчас\s+не\s+могу[^.]{0,40}напиш|отвлекусь[^.]{0,30}напиш|занята[^.]{0,30}напиш/i;

const ANKETA_TONE_RE =
  /^(?:привет[!.,\s]*)?(?:меня\s+зовут|я\s+\d{2}\s*лет|я\s+из\s+[а-яё\-]+,\s*работаю|о\s+себе\s*:|кратко\s+о\s+себе)/i;

// --- in-memory daily state ---
const dayKey = () => new Date().toISOString().slice(0, 10);
let phraseDay = dayKey();
/** accountId -> Map(normalizedPhrase -> count) */
const phraseCounts = new Map();
/** accountId:peerId -> { interestHits, lastFlipPhotoAt, coolUntil, busyUntil, badDay } */
const peerState = new Map();
/** accountId -> { lines: string[], dayMood } */
const accountDiary = new Map();
/** accountId:peerId -> { path, dueAt, caption } deferred media */
const deferredMedia = new Map();
/** accountId:peerId -> { dueAt, kind } deferred text return #14 */
const deferredText = new Map();
/** accountId -> { pitchWithoutInterest, kaifLoops } soft counters for #100 */
const accountRisk = new Map();

function resetDayIfNeeded() {
  const d = dayKey();
  if (d === phraseDay) return;
  phraseDay = d;
  phraseCounts.clear();
  for (const [k, st] of peerState) {
    if (st.coolUntil && st.coolUntil < Date.now()) st.coolUntil = 0;
    if (st.busyUntil && st.busyUntil < Date.now()) st.busyUntil = 0;
  }
}

function peerKey(accountId, peerId) {
  return `${accountId}:${String(peerId)}`;
}

function getPeerState(accountId, peerId) {
  resetDayIfNeeded();
  const k = peerKey(accountId, peerId);
  if (!peerState.has(k)) {
    peerState.set(k, {
      interestHits: 0,
      lastFlipPhotoAt: 0,
      coolUntil: 0,
      busyUntil: 0,
      badDay: false,
      lastPitchAt: 0,
      _hydrated: false,
    });
  }
  return peerState.get(k);
}

let gatesSchemaReady = null;
async function ensureNftGatesSchema() {
  if (gatesSchemaReady) return gatesSchemaReady;
  gatesSchemaReady = db
    .execute(
      `CREATE TABLE IF NOT EXISTS peer_nft_gates (
         account_id INT NOT NULL,
         peer_id VARCHAR(64) NOT NULL,
         interest_hits INT NOT NULL DEFAULT 0,
         last_flip_photo_at BIGINT NOT NULL DEFAULT 0,
         last_pitch_at BIGINT NOT NULL DEFAULT 0,
         updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         PRIMARY KEY (account_id, peer_id)
       )`,
    )
    .then(() => true)
    .catch((e) => {
      console.error('[humanHardening] peer_nft_gates:', e.message);
      gatesSchemaReady = null;
      return false;
    });
  return gatesSchemaReady;
}

async function hydratePeerGates(accountId, peerId) {
  const st = getPeerState(accountId, peerId);
  if (st._hydrated || accountId == null || peerId == null) return st;
  try {
    if (!(await ensureNftGatesSchema())) return st;
    const [[row]] = await db.execute(
      `SELECT interest_hits, last_flip_photo_at, last_pitch_at
       FROM peer_nft_gates WHERE account_id = ? AND peer_id = ? LIMIT 1`,
      [accountId, String(peerId)],
    );
    if (row) {
      st.interestHits = Math.max(st.interestHits, Number(row.interest_hits) || 0);
      st.lastFlipPhotoAt = Math.max(st.lastFlipPhotoAt, Number(row.last_flip_photo_at) || 0);
      st.lastPitchAt = Math.max(st.lastPitchAt, Number(row.last_pitch_at) || 0);
    }
    st._hydrated = true;
  } catch (_) {
    /* ignore — retry next call */
  }
  return st;
}

function persistPeerGates(accountId, peerId) {
  if (accountId == null || peerId == null) return;
  const st = getPeerState(accountId, peerId);
  ensureNftGatesSchema()
    .then((ok) => {
      if (!ok) return null;
      return db.execute(
        `INSERT INTO peer_nft_gates
           (account_id, peer_id, interest_hits, last_flip_photo_at, last_pitch_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           interest_hits = GREATEST(interest_hits, VALUES(interest_hits)),
           last_flip_photo_at = GREATEST(last_flip_photo_at, VALUES(last_flip_photo_at)),
           last_pitch_at = GREATEST(last_pitch_at, VALUES(last_pitch_at))`,
        [
          accountId,
          String(peerId),
          Number(st.interestHits) || 0,
          Number(st.lastFlipPhotoAt) || 0,
          Number(st.lastPitchAt) || 0,
        ],
      );
    })
    .catch(() => {});
}

/** #94 peer tier by history length + warmth proxy */
function peerTier(history) {
  const hist = Array.isArray(history) ? history : [];
  const n = hist.length;
  if (n < 8) return 'stranger';
  if (n < 30) return 'warm';
  return 'close';
}

function isCloneSkeptic(text) {
  return CLONE_SKEPTIC_RE.test(String(text || ''));
}

function noteExplicitInterest(accountId, peerId, text) {
  if (!EXPLICIT_FLIP_INTEREST_RE.test(String(text || ''))) return;
  const st = getPeerState(accountId, peerId);
  st.interestHits += 1;
  persistPeerGates(accountId, peerId);
}

function noteFlipPhotoSent(accountId, peerId) {
  const st = getPeerState(accountId, peerId);
  st.lastFlipPhotoAt = Date.now();
  persistPeerGates(accountId, peerId);
}

function notePitchSent(accountId, peerId) {
  const st = getPeerState(accountId, peerId);
  st.lastPitchAt = Date.now();
  persistPeerGates(accountId, peerId);
}

function noteRudeOrSexual(accountId, peerId, hours = 2) {
  const st = getPeerState(accountId, peerId);
  st.coolUntil = Date.now() + hours * 3600 * 1000;
}

function noteBusy(accountId, peerId, minutes = 45) {
  const st = getPeerState(accountId, peerId);
  st.busyUntil = Date.now() + minutes * 60 * 1000;
}

/** Минимум явных «интересно про флип/нфт» до питча. 0 = не блокируем по hits (0gv). */
const NFT_MIN_INTEREST_HITS = 0;

/** #66/#67 — suppress NFT voice/hint */
function shouldBlockNftPitch(accountId, peerId, text, history) {
  if (isCloneSkeptic(text)) return true;
  if (isBotTest(text)) return true;
  const st = getPeerState(accountId, peerId);
  if (NFT_MIN_INTEREST_HITS > 0 && st.interestHits < NFT_MIN_INTEREST_HITS) return true;
  if (st.lastFlipPhotoAt && Date.now() - st.lastFlipPhotoAt < 24 * 3600 * 1000) return true;
  if (st.coolUntil && Date.now() < st.coolUntil) return true;
  // #100: низкий human-score → не питчить сегодня
  if (shouldTightenFilters(accountId)) return true;
  return false;
}

/** Перед тикером/гейтом — подтянуть interestHits с диска после рестарта. */
async function shouldBlockNftPitchAsync(accountId, peerId, text, history) {
  await hydratePeerGates(accountId, peerId);
  return shouldBlockNftPitch(accountId, peerId, text, history);
}

/** #41/#65 hint */
function getCloneSkepticHint(text) {
  if (!isCloneSkeptic(text)) return null;
  return (
    'Собеседник намекает, что ты «как все / вторая такая / скрипт / бот». ' +
    'НЕ оправдывайся лекцией и НЕ питчи флип/NFT/токены и НЕ шли голосовое. ' +
    'Коротко и по-человечески: можно лёгкое «хах ну совпадение)», «неа, я не копипаста)», ' +
    'или извиниться за тон если он раздражён — и смени тему на него/день. 1 короткая фраза.'
  );
}

/** #61/#62 work boring / refuse */
function getWorkToneHint(text) {
  if (!/(?:работа|кем\s+работа|чем\s+занима|флип|токен|нфт)/i.test(String(text || ''))) {
    return null;
  }
  if (/не\s+хочу\s+(?:про\s+)?работ|достал[ао]?\s+про\s+работ|хватит\s+про\s+работ/i.test(text)) {
    return (
      'Он просит не говорить про работу. Согласись коротко: «ок, не про работу)» / «ладно, давай о другом)» — без питча.'
    );
  }
  return (
    'Если спрашивают про работу — ответь СКУЧНО и коротко (онлайн / с ноута), без энтузиазма и без «могу показать». ' +
    'Можно «сегодня не хочу про работу)». 1 фраза.'
  );
}

/** #76 busy */
function getBusyHint(text) {
  if (!BUSY_PEER_RE.test(String(text || ''))) return null;
  return (
    'Он занят / откладывает разговор. Коротко: «ок, напиши как свободен)» — и НЕ задавай новых вопросов. Без питча.'
  );
}

/** #81 confusion repair */
function getConfusionRepairHint(text) {
  if (!CONFUSED_TOPIC_RE.test(String(text || ''))) return null;
  return (
    'Он запутался в теме. Уточни одной фразой: «подожди, ты про А или про Б?» — без лекции и без NFT.'
  );
}

/** #72 bot-test */
function isBotTest(text) {
  return BOT_TEST_RE.test(String(text || '')) || CAPTCHA_TEST_RE.test(String(text || ''));
}

function getBotTestHint(text) {
  if (CAPTCHA_TEST_RE.test(String(text || ''))) {
    return (
      'Он даёт «тест»/капчу/пример/перевернуть слово. Ты НЕ ассистент. ' +
      'ЗАПРЕЩЕНО решать пример, переворачивать слова, вводить коды. ' +
      'Коротко и с иронией: «хах серьёзно)», «ну ты чего)», «не, я не калькулятор)» — 1 фраза, без оправданий.'
    );
  }
  if (BOT_TEST_RE.test(String(text || ''))) {
    return (
      'Он тестирует «жива ли ты / не бот». Не оправдывайся лекцией и не питчи. ' +
      'Ирония: «хах ну давай) я тут», «смешно) а ты сам?», «живые тоже так пишут)» — 1 короткая фраза.'
    );
  }
  return null;
}

function softenBotTestReply(reply, userMessage) {
  if (!isBotTest(userMessage)) return reply;
  const out = String(reply || '');
  // Если всё же решила пример / перевернула — заменить.
  if (
    /^\s*\d+\s*$/.test(out.trim()) ||
    /ответ\s*:?\s*\d+|равно\s*\d+|получится\s*\d+/i.test(out) ||
    /задом\s+наперед|перев[её]рнут/i.test(out)
  ) {
    return 'хах ну ты чего) я не калькулятор)';
  }
  if (/я\s+не\s+бот|я\s+живая|я\s+реальн|нейросет|chatgpt|ии\b/i.test(out)) {
    return 'хах живые тоже так пишут) а ты как день?';
  }
  return out;
}

/** #49 strip numbered/bulleted lists in short chat */
function stripChatLists(reply) {
  let out = String(reply || '');
  const lines = out.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const listish = lines.filter((l) => /^(?:\d+[.)]\s+|[-•*]\s+)/.test(l));
  if (listish.length >= 2) {
    // Склеиваем в одну живую фразу без нумерации.
    const body = listish
      .map((l) => l.replace(/^(?:\d+[.)]\s+|[-•*]\s+)/, ''))
      .join(', ');
    out = body.slice(0, 160);
    if (!/[)!.]$/.test(out)) out += ')';
  } else {
    out = out.replace(/(?:^|\n)\s*(?:\d+[.)]\s+|[-•*]\s+)/g, (m) =>
      m.startsWith('\n') ? '\n' : '',
    );
  }
  return out.replace(/\n{2,}/g, '\n').trim();
}

/** #48 anketa tone */
function stripAnketaTone(reply) {
  const out = String(reply || '').trim();
  if (!ANKETA_TONE_RE.test(out) && !/о\s+себе\s*:|кратко\s*:/i.test(out)) return out;
  if (out.length > 120 || /работаю|лет,|интересуюсь|познаком/i.test(out)) {
    return 'ну я так, обычная) а ты?';
  }
  return out;
}

/** #11–12 distracted / back */
function getDistractedHint(history) {
  const hist = Array.isArray(history) ? history : [];
  if (hist.length < 4) return null;
  // rare: only when last assistant was long ago in history markers — soft random
  if (Math.random() > 0.08) return null;
  return (
    'Иногда можно звучать так, будто была занята: короткое «ой сорри)» / «тут)» / «сек)» — без «отвлеклась» и без длинных оправданий.'
  );
}

/** #25–26 mild disagree */
function getMildOpinionHint() {
  try {
    return require('./humanIdeas10').mildDisagreeHint();
  } catch (_) {
    /* fallthrough */
  }
  if (Math.random() > 0.22) return null;
  return (
    'Иногда можно мягко не согласиться с мелочью («не согласна, сериалы лучше)» / «хм спорно)») — без конфликта.'
  );
}

/** #99 bad day mode hint */
function getBadDayHint(accountId) {
  resetDayIfNeeded();
  const diary = accountDiary.get(accountId);
  if (!diary || !diary.badDay) return null;
  return (
    'У тебя сегодня вялый день: ответы короче, меньше инициативы и вопросов, без питча и без восторгов.'
  );
}

/** #1 mini diary */
function ensureDiary(accountId) {
  resetDayIfNeeded();
  if (!accountDiary.has(accountId)) {
    const slots = [
      'утром ещё сонная, в телефоне',
      'днём сборы/дела по дому',
      'вечером музыка фоном',
      'сейчас просто туплю в рилсах',
      'после зала размазня)',
      'готовлю что-то простое',
    ];
    const badDay = Math.random() < 0.15;
    accountDiary.set(accountId, {
      day: dayKey(),
      lines: slots.sort(() => Math.random() - 0.5).slice(0, 3),
      badDay,
    });
  }
  const d = accountDiary.get(accountId);
  if (d.day !== dayKey()) {
    accountDiary.delete(accountId);
    return ensureDiary(accountId);
  }
  return d;
}

function getDiaryHint(accountId) {
  const d = ensureDiary(accountId);
  if (Math.random() > 0.2) return null;
  const line = d.lines[Math.floor(Math.random() * d.lines.length)];
  return `Если уместно одной деталью дня (не списком): «${line}» — своими словами, коротко.`;
}

/**
 * Aggregate extra system hints (Must/Should/Nice).
 */
function buildHardeningHints(
  text,
  history,
  { accountId = null, peerId = null, skipClone = false, systemPrompt = null, memoryHint = null } = {},
) {
  const parts = [];
  // clone обычно уже в detectHint — не дублируем, если skipClone.
  if (!skipClone) {
    const clone = getCloneSkepticHint(text);
    if (clone) parts.push(clone);
  }
  const busy = getBusyHint(text);
  if (busy) parts.push(busy);
  const cloneActive = isCloneSkeptic(text);
  const work = getWorkToneHint(text);
  if (work && !cloneActive) parts.push(work);
  const conf = getConfusionRepairHint(text);
  if (conf) parts.push(conf);
  const botTest = getBotTestHint(text);
  if (botTest) parts.push(botTest);
  if (accountId != null) {
    const bad = getBadDayHint(accountId);
    if (bad) parts.push(bad);
    const diary = getDiaryHint(accountId);
    if (diary && !cloneActive) parts.push(diary);
  }
  const distract = getDistractedHint(history);
  if (distract && !cloneActive) parts.push(distract);
  const opinion = getMildOpinionHint();
  if (opinion && !cloneActive) parts.push(opinion);
  if (!cloneActive) {
    try {
      const regHints = require('./humanIdeasRegistry').buildIdeasRegistryHints(
        history,
        text,
        { accountId, systemPrompt, memoryHint },
      );
      if (regHints) parts.push(regHints);
    } catch (_) {
      /* optional */
    }
  }
  try {
    const ms = require('./mediaSend');
    if (ms.isPackedThingsPhotoAsk(text, history)) {
      parts.push(
        'Просит фото вещей/коробок/сборов — таких кадров НЕТ. Не обещай «щас найду фото» и не шли селфи. ' +
          'Отмазка: бардак/стыдно/не фоткала, текстом.',
      );
    }
  } catch (_) {
    /* optional */
  }

  const tier = peerTier(history);
  if (tier === 'stranger') {
    parts.push('С ним ещё мало знакомства: короче (1 фраза), без питча и без длинных самопрезентаций.');
  } else if (tier === 'close') {
    parts.push('Диалог уже тёплый: можно чуть живее, но без канцелярита и без навязчивого питча.');
  }

  if (accountId != null && peerId != null) {
    // noteExplicitInterest — один раз в shouldSuppressNftForTurn / pipeline, не здесь.
    if (RUDE_PEER_RE.test(String(text || ''))) noteRudeOrSexual(accountId, peerId, 2);
    if (BUSY_PEER_RE.test(String(text || ''))) noteBusy(accountId, peerId, 45);
    const st = getPeerState(accountId, peerId);
    if (st.coolUntil && Date.now() < st.coolUntil) {
      parts.push('С ним недавно была грубость/давление — отвечай короче и холоднее, без флирта и питча.');
    }
    if (st.busyUntil && Date.now() < st.busyUntil) {
      parts.push('Он писал что занят — не допытывай; можно коротко отпустить разговор.');
    }
  }

  return parts.length ? parts.join('\n') : null;
}

/** #93 phrase ban — normalize & count outgoing */
function normalizePhrase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function registerOutgoing(accountId, reply) {
  resetDayIfNeeded();
  if (accountId == null || !reply) return;
  const n = normalizePhrase(reply);
  if (n.length < 8) return;
  if (!phraseCounts.has(accountId)) phraseCounts.set(accountId, new Map());
  const m = phraseCounts.get(accountId);
  m.set(n, (m.get(n) || 0) + 1);
}

/** #100 + #6 анти-эхо дня — жёстче лимит повторов за сутки */
function phraseBanLimitFor(accountId) {
  const { score } = computeHumanScore(accountId);
  if (score < 55) return 1;
  if (score < 75) return 2;
  return 3;
}

function isPhraseBanned(accountId, reply, limit = null) {
  resetDayIfNeeded();
  if (accountId == null || !reply) return false;
  const n = normalizePhrase(reply);
  // Раньше <8 пропускало «кайф)» / «ну ок)» — эхо копилось без бана.
  if (n.length < 4) return false;
  const m = phraseCounts.get(accountId);
  if (!m) return false;
  const lim = limit != null ? limit : phraseBanLimitFor(accountId);
  return (m.get(n) || 0) >= lim;
}

function notePitchWithoutInterest(accountId) {
  if (accountId == null) return;
  if (!accountRisk.has(accountId)) accountRisk.set(accountId, { pitchWithoutInterest: 0, kaifLoops: 0 });
  accountRisk.get(accountId).pitchWithoutInterest += 1;
}

function shouldTightenFilters(accountId) {
  const { score } = computeHumanScore(accountId);
  if (score < 70) return true;
  const risk = accountRisk.get(accountId);
  if (risk && risk.pitchWithoutInterest >= 3) return true;
  return false;
}

const PHRASE_ALTS = [
  'хм ну да)',
  'ага, поняла)',
  'короче ок)',
  'ну такое)',
  'ладно, я тут)',
];

/** #42/#43/#45/#92 postfilters */
function stripRepeatPonialaHah(reply, history, userMessage = '') {
  let out = String(reply || '');
  const recent = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-4)
    .map((m) => String(m.content || ''));
  // JS \b не видит кириллицу как word-char — якорим по пробелу/концу/punct.
  const ponialaN = recent.filter((c) => /^поняла(?:\s|\)|$|[.,!])/i.test(c.trim()) || /^поняла$/i.test(c.trim())).length;
  const hahN = recent.filter((c) => /^(?:хах|ахах+|ахаха)(?:\s|\)|$|[.,!]|,)/i.test(c.trim()) || /^(?:хах|ахах+|ахаха)$/i.test(c.trim())).length;
  if (ponialaN >= 2 && /^поняла/i.test(out.trim())) {
    out = out.replace(/^поняла\s*\)?[.,!]?\s*/i, 'ага, ');
  }
  if (hahN >= 2 && /^(?:хах|ахах+|ахаха)/i.test(out.trim())) {
    out = out.replace(/^(?:хах|ахах+|ахаха)\s*,?\s*/i, '');
  }
  const nuOkN = recent.filter((c) => /^(?:ну\s+)?ок\)?[.!]*$/i.test(c.trim())).length;
  if (nuOkN >= 2 && /^(?:ну\s+)?ок\)?/i.test(out.trim())) {
    const alts = ['норм)', 'ладно)', 'поняла)', 'ага)'];
    out = alts[Math.floor(Math.random() * alts.length)];
  }
  const shortAckN = recent.filter((c) =>
    /^(?:прикольно|норм|ну бывает|о как)\)?[.!]*$/i.test(c.trim()),
  ).length;
  if (
    shortAckN >= 2 &&
    /^(?:прикольно|норм|ну бывает|о как)\)?/i.test(out.trim())
  ) {
    const alts = ['ага, ясно)', 'хм ну да)', 'ладно, я тут)', 'хех ок)'];
    out = alts[Math.floor(Math.random() * alts.length)];
  }
  // «отвлеклась» — всегда режем (0mj): клише из hints + later_text.
  if (/отвлеклась/i.test(out)) {
    out = out
      .replace(/ой,?\s*просто\s+отвлеклась\)?[.,!]?\s*/gi, 'ой сорри) ')
      .replace(/сорри,?\s*отвлеклась\)?[.,!]?\s*/gi, 'сорри) ')
      .replace(/сори,?\s*отвлеклась\)?[.,!]?\s*/gi, 'сори) ')
      .replace(/просто\s+(?:немного\s+)?отвлеклась\)?[.,!]?\s*/gi, '')
      .replace(/немного\s+отвлеклась\)?[.,!]?\s*/gi, '')
      .replace(/отвлеклась(?:\s+немного)?\)?[.,!]?\s*/gi, '')
      .replace(/^\s*[,.]+\s*/, '')
      .trim();
    if (!out || out.length < 3) out = 'ой сорри, была занята)';
  }
  return out;
}

function stripRepeatSelfIntro(reply, history) {
  const out = String(reply || '');
  if (!SELF_INTRO_RE.test(out)) return out;
  const recent = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-12)
    .map((m) => String(m.content || ''));
  const already = recent.some((c) => SELF_INTRO_RE.test(c));
  if (!already) return out;
  return 'ну да онлайн кручусь)';
}

/**
 * Уже говорила про флип/токены — не вставляй снова в хобби/болтовню
 * (как у Артура: «в первый день ещё говорила»).
 */
function stripRepeatFlipPitch(reply, history, userMessage) {
  const out = String(reply || '');
  if (!NFT_PITCH_OUT_RE.test(out) && !/флип|токен|\bnft\b|нфт/i.test(out)) return out;
  let early = false;
  try {
    const jf = require('./jobFlipAsk');
    // Job-ask: ensureJobFlipHeardAsk сам решит день1 vs флип — тут не трогаем.
    if (jf.isJobOccupationAsk(userMessage)) return out;
    early = !jf.mayMentionFlipNft({ history });
  } catch (_) {
    /* optional */
  }
  if (/(?:флип|токен|\bnft\b|нфт|крипт)/i.test(String(userMessage || ''))) return out;
  const already = (Array.isArray(history) ? history : []).some(
    (m) => m && m.role === 'assistant' && /флип|токен|\bnft\b|нфт|крипт/i.test(String(m.content || '')),
  );
  if (!already && !early) return out;
  let cleaned = out
    .replace(/[.,!]?\s*(?:ещё\s+)?флиппингом\s+занимаюсь[^.!?\n]*/gi, '')
    .replace(/[.,!]?\s*(?:я\s+)?занимаюсь\s+флип[^.!?\n]*/gi, '')
    .replace(/[.,!]?\s*но\s+это\s+так,?\s+подработка[^.!?\n]*/gi, '')
    .replace(/[.,!]?\s*(?:ещё\s+)?(?:флипаю|флиплю|флипинг)[^.!?\n]*/gi, '')
    .replace(/[.,!]?\s*(?:про\s+)?(?:nft|нфт|токен)[^.!?\n]{0,50}/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([).,!])/g, '$1')
    .trim();
  if (!cleaned || cleaned.length < 4) return 'ну разное по мелочи)';
  return cleaned;
}

function stripAppearanceOnForeign(reply, userMessage) {
  const u = String(userMessage || '');
  const hasMediaCtx =
    /\[(?:ответ на|уточнение).*фото|фотограф|скрин|аватар|переслал|nft|meebit/i.test(u) ||
    /фото|скрин|картинк/i.test(u);
  if (!hasMediaCtx) return reply;
  if (!APPEARANCE_ON_FOREIGN_MEDIA_RE.test(String(reply || ''))) return reply;
  return 'хах это просто картинка на скрине)';
}

/** #85 no trailing question if he asked */
function stripQuestionIfHeAsked(reply, userMessage) {
  const u = String(userMessage || '');
  if (!/[?]/.test(u) && !extractAskCue(u)) return reply;
  let out = String(reply || '').trim();
  // drop last ? clause if we already should answer him
  if (!/[?]/.test(out)) return out;
  const parts = out.split(/(?<=[?])/);
  if (parts.length < 2) {
    return out.replace(/\s*[?][)!.]*\s*$/, ')');
  }
  // keep answer part, drop trailing question
  return parts.slice(0, -1).join('').trim().replace(/\s*$/, ')');
}

function extractAskCue(u) {
  return /(?:скажи|расскажи|ответь|что\s+думаешь|как\s+ты|почему|зачем|когда|где\s+ты)/i.test(u);
}

/** Голый кивок («ок)» / «поняла)») когда у него был вопрос / просьба. */
const BARE_STUB_OUT_RE =
  /^(?:ну\s+)?(?:да\s+)?(?:ок|окей|ага|угу|ладно|поняла?|ясно|кайф|ну да|хах ну да)\s*\)?\.?$/i;

const CY_END = '(?![а-яёa-z])';

function userNeedsContentReply(userMessage) {
  const t = String(userMessage || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length < 3) return false;
  // Чистый кивок человека — голый «ок)»/«поняла)» нормален.
  if (/^(?:ну\s+)?(?:да\s+)?(?:ок|окей|ага|угу|ладно|понял[а]?|ясно|кайф|мм+|хм+)\s*\)?\.?$/i.test(t)) {
    return false;
  }
  if (/[?]/.test(t)) return true;
  if (
    new RegExp(
      `^(?:ну\\s+|а\\s+|и\\s+|эй\\s+|слушай\\s+)?(?:что|чё|че|чего|как|чем|где|куда|когда|почему|зачем|кто|сколько|какой|какая|какие)${CY_END}`,
      'i',
    ).test(t)
  ) {
    return true;
  }
  if (
    new RegExp(
      `(?:скажи|расскажи|ответь|можешь|скинь|запиши|пришли|покажи|любишь|нравится)${CY_END}`,
      'i',
    ).test(t) &&
    t.length <= 180
  ) {
    return true;
  }
  // Длинная реплика / голосовое — кивком не отбиваем.
  if (t.length >= 36) return true;
  if (/^\[(?:Голосовое|голос|Voice)/i.test(String(userMessage || ''))) return true;
  return false;
}

function expandBareStubOnQuestion(reply, userMessage) {
  if (!reply) return reply;
  const tag = (String(reply).match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  const body = String(reply).slice(tag.length).trim();
  if (!BARE_STUB_OUT_RE.test(body)) return reply;
  if (!userNeedsContentReply(userMessage)) return reply;
  const u = String(userMessage || '');
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  if (new RegExp(`(?:видео|видос|круж|фот|селфи|лайф|live)${CY_END}`, 'i').test(u)) {
    return (
      tag +
      pick([
        'ой щас неудобно записывать, чуть позже)',
        'блин сейчас не могу, давай чуть попозже)',
        'ахах давай чуть позже, сейчас занята)',
      ])
    );
  }
  if (/(?:липецк|город|жила|жил(?![а-яёa-z])|откуда|переезд|тимашев|иванов|курск)/i.test(u)) {
    return (
      tag +
      pick([
        'ну да, тут долго была)',
        'ага, с детства почти)',
        'да тут выросла почти)',
      ])
    );
  }
  if (/(?:привет|хай|здаров|добр)/i.test(u) && u.length < 60) {
    return tag + pick(['привет) как дела?', 'хай) ну рассказывай)', 'привет) че как?)']);
  }
  return (
    tag +
    pick([
      'хм ну смотря как считать)',
      'короче да) а тебе как?',
      'ну в целом да) а тебе как?',
    ])
  );
}

/** #74 lighter: strip reask of known name/city if in history — hint-level mostly */
function stripReaskEcho(reply, history) {
  // if reply is only a re-question of city/name already answered by user recently — soften
  const out = String(reply || '');
  if (!/(?:как\s+тебя\s+зовут|ты\s+откуда|из\s+какого\s+города)/i.test(out)) return out;
  const users = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'user')
    .slice(-8)
    .map((m) => String(m.content || ''));
  const toldName = users.some((c) => /меня\s+зовут|я\s+[А-ЯA-Z][а-яa-z]{2,}/.test(c));
  const toldCity = users.some((c) => /я\s+из\s+|живу\s+в\s+/.test(c));
  if (toldName && /как\s+тебя\s+зовут/i.test(out)) return 'ага, помню как тебя)';
  if (toldCity && /ты\s+откуда|из\s+какого\s+города/i.test(out)) return 'поняла, да)';
  return out;
}

/** #20 / #7 bare ok + короткие кивки → reaction-only (вероятностно, не 100%) */
function preferReactionOnlyOnBareOk(userMessage, reply, opts = {}) {
  try {
    const { preferSilentReaction } = require('./opsQuality');
    // forceBareOk только если явно просили (smoke/tests); в проде — tier chance.
    if (
      preferSilentReaction(userMessage, {
        leadTier: opts.leadTier || 'cold',
        forceBareOk: opts.forceBareOk === true,
      })
    ) {
      return true;
    }
  } catch (_) {
    /* opsQuality optional at load */
  }
  if (!BARE_OK_RE.test(String(userMessage || '').trim())) return false;
  const out = String(reply || '').trim();
  if (out.length <= 12 && /^(?:ок|ага|угу|ладно|кайф|поняла)\b/i.test(out)) return true;
  return Math.random() < 0.45;
}

/** #92 template detector on last 20 assistant lines */
function looksTemplated(reply, history) {
  const n = normalizePhrase(reply);
  if (n.length < 12) return false;
  const recent = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-20)
    .map((m) => normalizePhrase(m.content));
  const hits = recent.filter((c) => c && (c === n || (c.includes(n.slice(0, 24)) && n.length > 20))).length;
  return hits >= 2;
}

function applyHardeningPostfilters(
  reply,
  history,
  userMessage,
  accountId = null,
  peerId = null,
  systemPrompt = null,
) {
  if (!reply) return reply;
  let out = String(reply);
  out = stripRepeatPonialaHah(out, history, userMessage);
  out = stripRepeatSelfIntro(out, history);
  out = stripRepeatFlipPitch(out, history, userMessage);
  try {
    out = require('./humanIdeasRegistry').applyIdeasRegistryPostfilters(
      out,
      history,
      userMessage,
      accountId,
      peerId,
      systemPrompt,
    );
  } catch (_) {
    /* optional */
  }
  out = stripAppearanceOnForeign(out, userMessage);
  out = stripQuestionIfHeAsked(out, userMessage);
  out = stripReaskEcho(out, history);
  // Один stub-pass в конце hardening (раньше было два — раздувало шум).
  out = expandBareStubOnQuestion(out, userMessage);
  out = stripChatLists(out);
  out = stripAnketaTone(out);
  out = softenBotTestReply(out, userMessage);
  if (isCloneSkeptic(userMessage) && NFT_PITCH_OUT_RE.test(out)) {
    out = 'хах ну совпадение) а ты как день?';
  }
  if (isBotTest(userMessage) && NFT_PITCH_OUT_RE.test(out)) {
    out = 'хах ну ты чего) а ты как день?';
  }
  if (accountId != null && shouldTightenFilters(accountId) && NFT_PITCH_OUT_RE.test(out)) {
    out = 'ну да онлайн кручусь)';
  }
  if (accountId != null && isPhraseBanned(accountId, out)) {
    out = PHRASE_ALTS[Math.floor(Math.random() * PHRASE_ALTS.length)];
  }
  if (looksTemplated(out, history) || (accountId != null && shouldTightenFilters(accountId) && looksTemplated(out, history))) {
    out = PHRASE_ALTS[Math.floor(Math.random() * PHRASE_ALTS.length)];
  }
  // ensureAckNotBare — один раз в aiResponderPostprocess.finalizeOutgoingReply.
  if (accountId != null) registerOutgoing(accountId, out);
  return out;
}

/** Interest hits для NFT-тиков (cold + hits≥2 → всё же можно). */
async function getPeerNftInterestHits(accountId, peerId) {
  await hydratePeerGates(accountId, peerId);
  return Number(getPeerState(accountId, peerId).interestHits || 0);
}

/** #55 block media soon after pitch/screenshot */
function shouldBlockMediaAfterPitch(accountId, peerId) {
  const st = getPeerState(accountId, peerId);
  // sync path: kick hydrate (nft already awaits; pipeline sync — fire-and-forget)
  if (!st._hydrated && accountId != null && peerId != null) {
    hydratePeerGates(accountId, peerId).catch(() => {});
  }
  const now = Date.now();
  if (st.lastFlipPhotoAt && now - st.lastFlipPhotoAt < 2 * 3600 * 1000) return true;
  if (st.lastPitchAt && now - st.lastPitchAt < 2 * 3600 * 1000) return true;
  return false;
}

/** Async gate for pipeline — await hydrate before checking pitch window. */
async function shouldBlockMediaAfterPitchAsync(accountId, peerId) {
  await hydratePeerGates(accountId, peerId);
  return shouldBlockMediaAfterPitch(accountId, peerId);
}

/** #10/#59 deferred media — schedule + peek/take (pipeline/inbound fire) */
function scheduleDeferredMedia(accountId, peerId, meta) {
  const delay =
    meta && meta.delayMs != null ? Number(meta.delayMs) : 30 * 60 * 1000;
  const job = {
    ...meta,
    accountId,
    peerId: String(peerId),
    kind: (meta && meta.kind) || 'photo',
    dueAt: Date.now() + (Number.isFinite(delay) ? delay : 30 * 60 * 1000),
  };
  deferredMedia.set(peerKey(accountId, peerId), job);
  return job;
}

function peekDueDeferredMedia(accountId, peerId) {
  const k = peerKey(accountId, peerId);
  const job = deferredMedia.get(k);
  if (!job || job.dueAt > Date.now()) return null;
  return job;
}

function takeDueDeferredMedia(accountId, peerId) {
  const k = peerKey(accountId, peerId);
  const job = deferredMedia.get(k);
  if (!job || job.dueAt > Date.now()) return null;
  deferredMedia.delete(k);
  return job;
}

function peekDueDeferredMedias() {
  const now = Date.now();
  const out = [];
  for (const job of deferredMedia.values()) {
    if (job && job.dueAt <= now) out.push(job);
  }
  return out;
}

function detectDeferredMediaPromise(reply) {
  return /(?:потом|позже|щас не|завтра)\s+(?:скину|пришлю|отправлю)|скину\s+потом/i.test(
    String(reply || ''),
  );
}

/** #14 — «напишу позже» */
function detectLaterTextPromise(reply) {
  return LATER_TEXT_PROMISE_RE.test(String(reply || ''));
}

let textPromiseSchema = null;
async function ensureTextPromiseTable() {
  if (textPromiseSchema) return textPromiseSchema;
  textPromiseSchema = db
    .execute(
      `CREATE TABLE IF NOT EXISTS text_promises (
        account_id BIGINT NOT NULL,
        peer_id VARCHAR(64) NOT NULL,
        due_at DATETIME NOT NULL,
        kind VARCHAR(32) NOT NULL DEFAULT 'text_return',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (account_id, peer_id),
        KEY idx_tp_due (due_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    )
    .catch((e) => {
      textPromiseSchema = null;
      throw e;
    });
  return textPromiseSchema;
}

function scheduleDeferredText(accountId, peerId, meta = {}) {
  const delay =
    meta.delayMs != null
      ? Number(meta.delayMs)
      : 15 * 60 * 1000 + Math.floor(Math.random() * 75 * 60 * 1000);
  const dueAt = Date.now() + (Number.isFinite(delay) ? delay : 30 * 60 * 1000);
  deferredText.set(peerKey(accountId, peerId), {
    ...meta,
    dueAt,
    kind: 'text_return',
  });
  ensureTextPromiseTable()
    .then(() =>
      db.execute(
        `INSERT INTO text_promises (account_id, peer_id, due_at, kind)
         VALUES (?, ?, ?, 'text_return')
         ON DUPLICATE KEY UPDATE due_at=VALUES(due_at), kind=VALUES(kind)`,
        [accountId, String(peerId), new Date(dueAt)],
      ),
    )
    .catch(() => {});
}

function takeDueDeferredText(accountId, peerId) {
  const k = peerKey(accountId, peerId);
  const job = deferredText.get(k);
  if (!job || job.dueAt > Date.now()) return null;
  deferredText.delete(k);
  ensureTextPromiseTable()
    .then(() =>
      db.execute(`DELETE FROM text_promises WHERE account_id = ? AND peer_id = ?`, [
        accountId,
        String(peerId),
      ]),
    )
    .catch(() => {});
  return job;
}

/** После рестарта — вернуть «напишу позже» из БД в память. */
async function restoreTextPromisesFromDb() {
  try {
    await ensureTextPromiseTable();
    const [rows] = await db.execute(
      `SELECT account_id, peer_id, due_at FROM text_promises
       WHERE due_at > NOW() - INTERVAL 6 HOUR
       LIMIT 300`,
    );
    let n = 0;
    for (const row of rows || []) {
      const dueAt = new Date(row.due_at).getTime();
      deferredText.set(peerKey(row.account_id, row.peer_id), {
        dueAt: Math.max(Date.now() + 5000, dueAt),
        kind: 'text_return',
        fromDb: true,
      });
      n += 1;
    }
    if (n) console.log(`[humanHardening] восстановлено text_promises: ${n}`);
    return n;
  } catch (e) {
    console.warn('[humanHardening] restore text_promises:', e.message);
    return 0;
  }
}

function peekDueDeferredTexts(now = Date.now()) {
  const due = [];
  for (const [k, job] of deferredText) {
    if (job.dueAt <= now) {
      const colon = k.indexOf(':');
      due.push({
        accountId: Number(k.slice(0, colon)),
        peerId: k.slice(colon + 1),
        job,
      });
    }
  }
  return due;
}

function cancelDeferredText(accountId, peerId) {
  deferredText.delete(peerKey(accountId, peerId));
  ensureTextPromiseTable()
    .then(() =>
      db.execute(`DELETE FROM text_promises WHERE account_id = ? AND peer_id = ?`, [
        accountId,
        String(peerId),
      ]),
    )
    .catch(() => {});
}

/** #96 — единый reason-лог */
function logOutboundReason(accountId, peerLabel, kind, detail = {}) {
  const bits = Object.entries(detail)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 60) : v}`)
    .join(' ');
  console.log(`[${peerLabel || accountId}] outbound ${kind}${bits ? ' ' + bits : ''}`);
}

/** #100 human-score snapshot (lightweight) */
function computeHumanScore(accountId) {
  resetDayIfNeeded();
  const m = phraseCounts.get(accountId);
  let repeats = 0;
  if (m) {
    for (const c of m.values()) if (c >= 3) repeats += 1;
  }
  const risk = accountRisk.get(accountId) || { pitchWithoutInterest: 0, kaifLoops: 0 };
  const score = Math.max(
    0,
    100 - repeats * 8 - (risk.pitchWithoutInterest || 0) * 5 - (risk.kaifLoops || 0) * 4,
  );
  return {
    score,
    repeats,
    pitchWithoutInterest: risk.pitchWithoutInterest || 0,
    day: phraseDay,
    tighten: score < 70,
  };
}

/** #84 — несколько его строк в одном ходе: один ответ на всё */
function getBurstReplyHint(userMessage) {
  const lines = String(userMessage || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  return (
    `Он прислал ${lines.length} сообщения подряд (склеены через перевод строки). ` +
    'Ответь ОДНИМ коротким ответом на весь пакет, не по одному на каждую строку. ' +
    'Приоритет — последний вопрос, если есть.'
  );
}

module.exports = {
  CLONE_SKEPTIC_RE,
  BOT_TEST_RE,
  CAPTCHA_TEST_RE,
  isCloneSkeptic,
  isBotTest,
  peerTier,
  getCloneSkepticHint,
  getBotTestHint,
  buildHardeningHints,
  shouldBlockNftPitch,
  shouldBlockNftPitchAsync,
  hydratePeerGates,
  getPeerNftInterestHits,
  noteExplicitInterest,
  noteFlipPhotoSent,
  notePitchSent,
  noteRudeOrSexual,
  noteBusy,
  notePitchWithoutInterest,
  applyHardeningPostfilters,
  preferReactionOnlyOnBareOk,
  shouldBlockMediaAfterPitch,
  shouldBlockMediaAfterPitchAsync,
  scheduleDeferredMedia,
  peekDueDeferredMedia,
  peekDueDeferredMedias,
  takeDueDeferredMedia,
  detectDeferredMediaPromise,
  detectLaterTextPromise,
  scheduleDeferredText,
  takeDueDeferredText,
  peekDueDeferredTexts,
  cancelDeferredText,
  restoreTextPromisesFromDb,
  logOutboundReason,
  computeHumanScore,
  shouldTightenFilters,
  phraseBanLimitFor,
  getBurstReplyHint,
  ensureDiary,
  registerOutgoing,
  isPhraseBanned,
  // smoke helpers
  stripRepeatPonialaHah,
  stripRepeatSelfIntro,
  stripRepeatFlipPitch,
  stripAppearanceOnForeign,
  stripQuestionIfHeAsked,
  expandBareStubOnQuestion,
  userNeedsContentReply,
  stripChatLists,
  stripAnketaTone,
  softenBotTestReply,
  looksTemplated,
  __testClearPeerMemory: (accountId, peerId) => {
    peerState.delete(peerKey(accountId, peerId));
  },
};
