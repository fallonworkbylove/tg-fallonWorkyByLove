/**
 * humanIdeas11 (0gl) — ещё 10 идей человечности:
 * 1 анти-терапевт   2 один вопрос максимум   3 реакция на шутку
 * 4 анти повтор «чем занимаешься»   5 без EN-офиса
 * 6 микро «хм/сек»   7 без питча после его шаринга
 * 8 стёжка темы из истории   9 анти «я понимаю» пустышка
 * 10 короче на «ок?» / уточнение
 */

const THERAPIST_RE =
  /(?:важно\s+что\s+ты\s+чувств|давай\s+поговорим\s+об\s+этом|я\s+слышу\s+тебя|тво[ие]\s+чувства\s+важн|безопасн\w+\s+пространств|валидир|как\s+ты\s+с\s+этим\s+справля)/i;

const EN_OFFICE_RE =
  /\b(?:anyway|basically|literally|sure thing|got it|no worries|of course|by the way|tbh|imo|idk)\b/gi;

const OPENER_RE =
  /(?:чем\s+(?:занимаешь|занят)|как\s+(?:день|дела|настроен)|что\s+(?:делаешь|нового)|расскажи\s+о\s+себе)/i;

const HIS_SHARE_RE =
  /(?:у\s+меня\s+|я\s+(?:работаю|живу|болею|устал|разв[её]л)|моя?\s+(?:собак|кот|мама|жена|работ)|сегодня\s+на\s+смен)/i;

const NFT_PITCH_OUT_RE =
  /(?:флип|nft|токен|цифров\w+\s+токен|скрины?\s+прибыл|профит)/i;

const EMPTY_EMPATHY_RE =
  /^(?:я\s+(?:тебя\s+)?понимаю|понимаю\s+тебя|сочувствую|поддерж\w+)\s*[).!]?\s*$/i;

const JOKE_RE =
  /(?:ахах|ахаха|лол|ору|ржу|шутк|прикол|😂|🤣|кек|哈哈)|^ха+х+\b/i;

const MICRO_PREFIXES = ['хм', 'сек)', 'ой', 'а'];

function stripTherapistTone(reply) {
  let out = String(reply || '');
  if (!THERAPIST_RE.test(out)) return out;
  out = out
    .replace(THERAPIST_RE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
  if (!out || out.length < 3) return 'ну да) слышу тебя';
  return out;
}

/** #2 — не больше одного вопроса в ответе */
function stripDoubleQuestion(reply) {
  const out = String(reply || '');
  const parts = out.split(/(?<=[?])/);
  if (parts.filter((p) => /\?/.test(p)).length <= 1) return out;
  // оставляем первый вопрос + хвост без ?
  let kept = '';
  let sawQ = false;
  for (const p of parts) {
    if (/\?/.test(p)) {
      if (!sawQ) {
        kept += p;
        sawQ = true;
      } else {
        kept += p.replace(/\?/g, '').replace(/\s+$/, '');
      }
    } else {
      kept += p;
    }
  }
  return kept.replace(/\s{2,}/g, ' ').trim();
}

/** #3 хинт: он шутит → короткая реакция */
function jokeAckHint(userMessage) {
  const t = String(userMessage || '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .trim();
  if (!t || t.length > 120) return null;
  if (!JOKE_RE.test(t) && !/(?:^|\s)ха+х+(?:\s|$)/i.test(t)) return null;
  if (/[?]/.test(t) && t.length > 40) return null;
  return (
    'Он шутит / смеётся — ответь коротко реакцией (ахах / жесть / ну ты) + максимум полфразы. ' +
    'Без морали, без питча, без «а что ещё нового?».'
  );
}

/** #4 уже спрашивала «чем занимаешься» */
function antiOpenerRepeatHint(history) {
  const hist = Array.isArray(history) ? history : [];
  const asked = hist
    .filter((m) => m && m.role === 'assistant')
    .slice(-10)
    .some((m) => OPENER_RE.test(String(m.content || '')));
  if (!asked) return null;
  return (
    'Ты уже спрашивала «чем занимаешься / как день» недавно — НЕ повторяй этот opener. ' +
    'Цепляйся за его последнюю тему или кивни коротко.'
  );
}

function stripOpenerRepeat(reply, history) {
  const hist = Array.isArray(history) ? history : [];
  const asked = hist
    .filter((m) => m && m.role === 'assistant')
    .slice(-10)
    .some((m) => OPENER_RE.test(String(m.content || '')));
  if (!asked) return reply;
  const out = String(reply || '');
  if (!OPENER_RE.test(out)) return out;
  return out
    .replace(/[^.?!]*?(?:чем\s+(?:занимаешь|занят)|как\s+(?:день|дела)|что\s+делаешь|расскажи\s+о\s+себе)[^.?!]*[.?!]?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || 'поняла тебя)';
}

/** #5 EN office fillers */
function stripEnOffice(reply) {
  let out = String(reply || '');
  if (!EN_OFFICE_RE.test(out)) return out;
  EN_OFFICE_RE.lastIndex = 0;
  out = out.replace(EN_OFFICE_RE, '').replace(/\s{2,}/g, ' ').trim();
  return out || 'поняла тебя)';
}

/** #6 иногда короткий префикс «подумала» */
function maybeMicroThinkPrefix(reply, userMessage) {
  const out = String(reply || '').trim();
  if (!out || out.length < 12) return out;
  const incoming = String(userMessage || '').replace(/^\[[^\]]*\]:\s*/gm, '').trim();
  if (incoming.length < 50) return out;
  if (/^(?:хм|сек|ой|а)\b/i.test(out)) return out;
  if (Math.random() > 0.18) return out;
  const p = MICRO_PREFIXES[Math.floor(Math.random() * MICRO_PREFIXES.length)];
  return `${p} ${out}`;
}

/** #7 после его личного шаринга — режем питч из ответа */
function stripSelfPitchAfterHisShare(reply, userMessage) {
  const u = String(userMessage || '');
  if (!HIS_SHARE_RE.test(u)) return reply;
  const out = String(reply || '');
  if (!NFT_PITCH_OUT_RE.test(out)) return out;
  return out
    .replace(/[^.?!]*(?:флип\w*|nft|токен\w*|скрины?\s+прибыл|профит)[^.?!]*[.?!]?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || 'ого) как ты с этим)';
}

/** #8 стёжка: вернись к якорю из его недавних реплик */
function topicStitchHint(history, userMessage) {
  const hist = Array.isArray(history) ? history : [];
  if (hist.length < 4) return null;
  if (Math.random() > 0.28) return null;
  const last = String(userMessage || '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .trim();
  if (last.length < 8 || last.length > 80) return null;
  if (/[?]/.test(last) && last.length < 35) return null;
  const users = hist
    .filter((m) => m && m.role === 'user')
    .slice(-8, -1)
    .map((m) =>
      String(m.content || '')
        .replace(/^\[[^\]]*\]:\s*/gm, '')
        .trim(),
    );
  const anchor = users
    .map((t) => t.match(/(?:смен|зал|собак|кот|машин|сериал|мама|работ|болез|переезд)\w*/i))
    .find((m) => m);
  if (!anchor) return null;
  if (new RegExp(anchor[0], 'i').test(last)) return null;
  return (
    `Можно одной короткой стёжкой к его теме «${anchor[0]}» (если уместно), без допроса и без питча.`
  );
}

/** #9 пустая эмпатия → живее */
function stripEmptyEmpathy(reply) {
  const out = String(reply || '').trim();
  if (!EMPTY_EMPATHY_RE.test(out)) return out;
  const alts = ['ну жесть)', 'ох тяжёлое)', 'поняла тебя)', 'ага слышу)'];
  return alts[Math.floor(Math.random() * alts.length)];
}

/** #10 на короткое уточнение «ок?» / «да?» — ещё короче */
function shortenOnTinyAsk(reply, userMessage) {
  const u = String(userMessage || '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .trim();
  if (!/^(?:ок|да|ну|ага|угу|точно|правда|серь[её]зно)\s*[?)]*$/i.test(u)) return reply;
  let out = String(reply || '').trim();
  if (out.length <= 36) return out;
  const cut = out.split(/(?<=[.!)])\s+/)[0] || out;
  const short = cut.slice(0, 36).trim();
  return short || 'поняла тебя)';
}

function applyIdeas11Postfilters(reply, history, userMessage) {
  let out = String(reply || '');
  out = stripTherapistTone(out);
  out = stripEnOffice(out);
  out = stripOpenerRepeat(out, history);
  out = stripSelfPitchAfterHisShare(out, userMessage);
  out = stripEmptyEmpathy(out);
  out = stripDoubleQuestion(out);
  out = shortenOnTinyAsk(out, userMessage);
  out = maybeMicroThinkPrefix(out, userMessage);
  return out;
}

function buildIdeas11Hints(history, userMessage) {
  const parts = [];
  const j = jokeAckHint(userMessage);
  if (j) parts.push(j);
  const o = antiOpenerRepeatHint(history);
  if (o) parts.push(o);
  const s = topicStitchHint(history, userMessage);
  if (s) parts.push(s);
  return parts.length ? parts.join('\n') : null;
}

module.exports = {
  stripTherapistTone,
  stripDoubleQuestion,
  jokeAckHint,
  antiOpenerRepeatHint,
  stripOpenerRepeat,
  stripEnOffice,
  maybeMicroThinkPrefix,
  stripSelfPitchAfterHisShare,
  topicStitchHint,
  stripEmptyEmpathy,
  shortenOnTinyAsk,
  applyIdeas11Postfilters,
  buildIdeas11Hints,
  THERAPIST_RE,
  EN_OFFICE_RE,
  OPENER_RE,
};
