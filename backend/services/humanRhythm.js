/**
 * humanRhythm (0gj) — ритм как у человека:
 * 1) думать / ждать / слать (hold incomplete, ack→текст)
 * 2) delay ≠ длина ответа (think отдельно от typing)
 * 3) карточка: «нет в фактах — не выдумывай»
 * 6) кто ведёт: длинный он → короткие реакции; односложно → чуть раскрыться
 */
const humanExtra = require('./humanExtra');

function plainLen(text) {
  return String(text || '')
    .replace(/<<[^>]+>>/g, '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/**
 * Сообщение похоже на «ещё допишет» — чуть дольше копить в буфере.
 */
function looksIncomplete(userMessage) {
  const t = String(userMessage || '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .trim();
  if (!t || t.length > 90) return false;
  if (/[?]/.test(t)) return false;
  if (/[.!…]$/.test(t)) return false;
  if (/[,:;]$/.test(t)) return true;
  if (/\b(?:и|а|но|ну|типа|короче|кароч|щас|сейчас|вот)\s*$/i.test(t)) return true;
  if (t.length <= 18 && !/[.!?)]$/.test(t)) return true;
  return false;
}

/** Сколько ждать в агрегации (мс), с учётом «ещё допишет». */
function aggregateWindowMs(userMessage, baseMs = 3200) {
  const base = Math.max(800, Number(baseMs) || 3200);
  if (!looksIncomplete(userMessage)) return base;
  return Math.min(7500, base + 1800 + Math.floor(Math.random() * 2200));
}

/**
 * Пауза до ответа: think (независимо от длины) + typing (слабо от длины).
 * Короткий ответ может думать долго; длинный — уйти быстро («уже знала»).
 */
function reshapeDelayPair({
  baseDelayMs,
  outText,
  incomingText = '',
  accountId = null,
  moodMul = null,
} = {}) {
  const pace = accountId != null ? humanExtra.getAccountPace(accountId) : null;
  let mul = pace?.typingMul || 1;
  // #6: typing/think чуть следует тону входящего (scaleIdeasPack mood echo).
  try {
    const extra =
      moodMul != null
        ? Number(moodMul)
        : require('./scaleIdeasPack').typingMoodMul(incomingText);
    if (Number.isFinite(extra) && extra > 0) mul *= extra;
  } catch (_) {
    /* optional */
  }
  const outLen = plainLen(outText);
  const inLen = plainLen(incomingText);

  // think: от сложности входящего + рандом, НЕ от длины ответа
  let think = 700 + Math.random() * 1600;
  if (inLen > 160) think += 600 + Math.random() * 1400;
  else if (inLen > 80) think += 300 + Math.random() * 800;
  else if (inLen <= 12) think *= 0.65;
  if (/[?]/.test(String(incomingText || ''))) think += 200 + Math.random() * 700;
  // иногда «уже знала что сказать» — короткий think даже на длинный out
  if (outLen > 80 && Math.random() < 0.35) think *= 0.45;
  // иногда короткий out, но «задумалась»
  if (outLen > 0 && outLen <= 28 && Math.random() < 0.4) {
    think += 1200 + Math.random() * 2800;
  }
  think *= mul;

  // typing: слабее привязан к длине; длинный текст не всегда долго «печатает»
  let typing;
  if (!outLen) typing = 300 + Math.random() * 400;
  else if (outLen <= 12) typing = 450 + Math.random() * 550;
  else if (outLen <= 40) typing = 700 + Math.random() * 900 + outLen * 18;
  else {
    const cps = 9 + Math.random() * 8;
    typing = (outLen / cps) * 1000;
    if (Math.random() < 0.3) typing *= 0.55; // уже набрала в голове
  }
  typing = Math.min(7200, Math.max(400, Math.round(typing * mul)));

  const base = Number(baseDelayMs);
  const floor = Number.isFinite(base) && base > 0 ? Math.round(base * 0.55) : 900;
  const shaped = Math.round(think + typing);
  // не короче пола от настроек/tempo, но не раздуваем в 3×
  const delayMs = Math.max(floor, Math.min(Math.max(shaped, floor), Math.max(floor * 2.4, shaped)));
  const typingMs = Math.min(typing, delayMs);
  return { delayMs, typingMs, thinkMs: Math.round(think) };
}

/**
 * Он ведёт (длинно) → короткие реакции, без своего питча.
 * Односложно → чуть раскрыться (жизнь), не NFT.
 */
function whoLeadsHint(history, userMessage) {
  const hist = Array.isArray(history) ? history : [];
  const last = String(userMessage || '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .trim();
  const recentUser = hist
    .filter((h) => h && h.role === 'user')
    .slice(-4)
    .map((h) =>
      String(h.content || '')
        .replace(/^\[[^\]]*\]:\s*/gm, '')
        .trim(),
    );
  const lens = recentUser.map((t) => t.length).filter((n) => n > 0);
  const avg = lens.length
    ? lens.reduce((a, b) => a + b, 0) / lens.length
    : last.length;
  const lastLen = last.length;

  if (lastLen >= 120 || (avg >= 90 && lastLen >= 60)) {
    return (
      'Он сейчас ВЕДЁТ разговор (длинно пишет). Ответь коротко: реакция + 1 уточнение по ЕГО теме. ' +
      'Своё (работа/хобби/флип/NFT) — максимум полфразы или ноль. Не перехватывай тему.'
    );
  }
  if (lastLen > 0 && lastLen <= 18 && !/[?]/.test(last) && avg <= 35) {
    return (
      'Он отвечает односложно — чуть раскрой СВОЮ жизнь (день/мелочь), 1 короткий вопрос ему. ' +
      'Без NFT/флипа/скринов и без анкеты из трёх пунктов.'
    );
  }
  return null;
}

/** Чаще реакция→текст, если он написал длинно и у нас есть и reaction и текст. */
function boostReactThenTextMs(baseMs, userMessage, reaction, outText) {
  if (!reaction || !outText) return baseMs || 0;
  const len = plainLen(userMessage);
  if (len < 100) return baseMs || 0;
  if (baseMs > 0) return baseMs;
  if (Math.random() > 0.55) return 0;
  return 6000 + Math.floor(Math.random() * 18000);
}

/** Доп. строки к memory-карточке: честное «не помню». */
function appendHonestMemoryRule(memoryHint) {
  const h = String(memoryHint || '');
  if (!h.trim()) {
    return (
      'КАРТОЧКА пуста: не выдумывай город/работу/питомца/имя. ' +
      'Если спросит «ты помнишь?» — «бля забыла) напомни», без фантазий.'
    );
  }
  if (/не выдумывай|забыла\)\s*напомни/i.test(h)) return h;
  return (
    h +
    '\nЕсли факта НЕТ в КАРТОЧКЕ / ПАМЯТИ — не выдумывай. Лучше «бля забыла) напомни», чем ложный факт.'
  );
}

const RECALL_PROBE_RE =
  /(?:ты\s+)?помн(?:ишь|иш)|не\s+помнишь|я\s+же\s+(?:тебе\s+)?говор|я\s+(?:же\s+)?рассказ|ты\s+забыл[а]?|напоминан/i;

const TYPE_PROBE = [
  { type: 'pet', re: /собак|кот[аеу]?\b|кошк|питомец|кличк|пёс|пес\b|хвостат/i },
  { type: 'city', re: /город|живу|живёшь|живешь|откуда\s+я|где\s+я\s+живу/i },
  { type: 'work', re: /работ|смен|начальник|кем\s+я|где\s+я\s+работа/i },
  { type: 'name', re: /как\s+меня\s+зовут|мо[её]\s+имя|мое\s+имя/i },
  { type: 'hobby', re: /хобби|зал|качалк|увлека/i },
  { type: 'family', re: /мама|папа|брат|сестра|жен[аы]|девушк/i },
];

const FORGET_REPLIES = [
  'бля забыла) напомни',
  'ой хз вылетело) напомни)',
  'честно не помню уже) скажи ещё раз',
  'бля вылетело) что там было?',
];

function cleanUserText(userMessage) {
  return String(userMessage || '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickForgetReply() {
  return FORGET_REPLIES[Math.floor(Math.random() * FORGET_REPLIES.length)];
}

/**
 * Он просит вспомнить факт о нём. { type, probe } или null.
 * type — pet/city/work/… или null (голое «помнишь?»).
 */
function detectRecallAsk(userMessage) {
  const t = cleanUserText(userMessage);
  if (!t || t.length < 4) return null;
  const probe =
    RECALL_PROBE_RE.test(t) ||
    /как\s+(?:зовут|называ)\s+(?:мою|моего|моя|мой)\b/i.test(t) ||
    /(?:какой|какая|какие)\s+у\s+меня\b/i.test(t) ||
    /где\s+я\s+(?:живу|работа)/i.test(t) ||
    /кем\s+я\s+работа/i.test(t);
  if (!probe) return null;
  const hit = TYPE_PROBE.find((p) => p.re.test(t));
  return { type: hit ? hit.type : null, probe: true };
}

function hasFactType(facts, type) {
  const list = Array.isArray(facts) ? facts : [];
  if (!type) return list.length > 0;
  const aliases =
    type === 'work' || type === 'job'
      ? ['work', 'job']
      : type === 'family' || type === 'kids'
        ? ['family', 'kids']
        : [type];
  return list.some((f) => {
    const ft = typeof f === 'string' ? f : f && f.fact_type;
    return aliases.includes(String(ft || ''));
  });
}

/** Хинт в промпт: вспомни из карточки ИЛИ честно забудь. */
function honestForgetHint(userMessage, facts) {
  const ask = detectRecallAsk(userMessage);
  if (!ask) return null;
  if (ask.type && hasFactType(facts, ask.type)) {
    return (
      `Он спрашивает про «${ask.type}» — бери ТОЛЬКО из КАРТОЧКИ/ПАМЯТИ, не додумывай детали.`
    );
  }
  if (ask.type && !hasFactType(facts, ask.type)) {
    return (
      `Он спрашивает «помнишь?» про ${ask.type}, а в карточке ЭТОГО НЕТ. ` +
      'Ответь коротко «бля забыла) напомни» — НЕ выдумывай имя/город/кличку/работу.'
    );
  }
  if (!facts || !facts.length) {
    return (
      'Он проверяет память, карточка пуста. Ответь «бля забыла) напомни» — без фантазий.'
    );
  }
  return (
    'Он спрашивает «помнишь?» — только факты из КАРТОЧКИ; иначе коротко «бля забыла) напомни».'
  );
}

/**
 * Постфильтр: нет факта в карточке + он просит вспомнить → не даём выдумку.
 */
function applyHonestForget(reply, userMessage, facts) {
  const ask = detectRecallAsk(userMessage);
  if (!ask) return reply;
  const missing = ask.type ? !hasFactType(facts, ask.type) : !(facts && facts.length);
  if (!missing) return reply;
  const r = String(reply || '').trim();
  if (!r) return pickForgetReply();
  // Уже честно забыла — не трогаем.
  if (/забыл|не помн|вылетел|напомни|хз\b/i.test(r) && !/(?:^|[,.\s])(?:да[, ]+)?помню/i.test(r)) {
    return reply;
  }
  // Нет факта в карточке — не даём «помню / Барсик / Москва».
  return pickForgetReply();
}

module.exports = {
  looksIncomplete,
  aggregateWindowMs,
  reshapeDelayPair,
  whoLeadsHint,
  boostReactThenTextMs,
  appendHonestMemoryRule,
  detectRecallAsk,
  hasFactType,
  honestForgetHint,
  applyHonestForget,
  pickForgetReply,
  plainLen,
};
