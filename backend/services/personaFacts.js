/**
 * Слой фактов персонажа: город / переезд / «как давно» — из промпта,
 * без выдумок. Категории вопросов, не списки отдельных слов-фиксов.
 */

function bare(userMessage) {
  return String(userMessage || '')
    .replace(/^\[[^\]]*\]:\s*/gm, '')
    .replace(/\n?\[(?:Ответ на сообщение|ответ на|уточнение к)[^\]]*\]:?/gi, '')
    .replace(/\[Голосовое\]:?\s*/gi, '')
    .trim();
}

function cityStem(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-яa-z\-]/gi, '')
    .replace(
      /(ского|скому|ским|ском|ого|ому|ым|ом|ем|ей|ой|ая|ое|ые|ую|ии|ий|ый|а|я|у|е|и|ы|о)$/i,
      '',
    )
    .slice(0, 7);
}

function sameCity(a, b) {
  const sa = cityStem(a);
  const sb = cityStem(b);
  if (!sa || !sb || sa.length < 3 || sb.length < 3) return false;
  return sa === sb || sa.startsWith(sb) || sb.startsWith(sa);
}

/** Именительный → винительный для «еду/переезжаю в X». */
function inCityAcc(name) {
  const n = String(name || '').trim();
  if (!n) return n;
  if (/^москв/i.test(n)) return 'Москву';
  if (/^анап/i.test(n)) return 'Анапу';
  if (/^калуг/i.test(n)) return 'Калугу';
  if (/^самар/i.test(n)) return 'Самару';
  if (/^казан/i.test(n)) return 'Казань';
  if (/^рязан/i.test(n)) return 'Рязань';
  if (/^твер/i.test(n)) return 'Тверь';
  if (/^тул/i.test(n)) return 'Тулу';
  if (/^химк/i.test(n)) return 'Химки';
  if (/^нижн/i.test(n)) return /новгород/i.test(n) ? 'Нижний Новгород' : 'Нижний';
  if (/^сочи$/i.test(n)) return 'Сочи';
  // м.р. на согласную / -ск: совпадает с именительным
  if (/[ая]$/i.test(n)) return n.replace(/[ая]$/i, 'у');
  return n;
}

/** Именительный → «в X» (предложный). Уже предложный не трогаем. */
function inCityPrep(name) {
  const n = String(name || '').trim();
  if (!n) return n;
  // Уже предложный / из промпта «в Нижнем» — не наращивать ещё раз.
  if (
    /^(?:Москве|Анапе|Сочи|Липецке|Белгороде|Курске|Калуге|Воронеже|Краснодаре|Ростове|Самаре|Казани|Твери|Туле|Рязани|Тимашевске|Красноярске|Иванове|Химках|Нижнем(?:\s+Новгороде)?|Великом\s+Новгороде)$/i.test(
      n,
    )
  ) {
    return n;
  }
  if (/^нижн/i.test(n)) return /новгород/i.test(n) ? 'Нижнем Новгороде' : 'Нижнем';
  if (/^велик/i.test(n) && /новгород/i.test(n)) return 'Великом Новгороде';
  if (/^москв/i.test(n)) return 'Москве';
  if (/^анап/i.test(n)) return 'Анапе';
  if (/^липецк/i.test(n)) return 'Липецке';
  if (/^тимашевск/i.test(n)) return 'Тимашевске';
  if (/^красноярск/i.test(n)) return 'Красноярске';
  if (/^иванов/i.test(n)) return 'Иванове';
  if (/^химк/i.test(n)) return 'Химках';
  const map = {
    Москва: 'Москве',
    Анапа: 'Анапе',
    Сочи: 'Сочи',
    Липецк: 'Липецке',
    Белгород: 'Белгороде',
    Курск: 'Курске',
    Калуга: 'Калуге',
    Воронеж: 'Воронеже',
    Краснодар: 'Краснодаре',
    Ростов: 'Ростове',
    Самара: 'Самаре',
    Казань: 'Казани',
    Тверь: 'Твери',
    Тула: 'Туле',
    Рязань: 'Рязани',
    Тимашевск: 'Тимашевске',
    Красноярск: 'Красноярске',
    Иваново: 'Иванове',
    Химки: 'Химках',
    'Нижний Новгород': 'Нижнем Новгороде',
    Нижний: 'Нижнем',
    'Великий Новгород': 'Великом Новгороде',
  };
  if (map[n]) return map[n];
  if (/[ая]$/i.test(n)) return n.replace(/[ая]$/i, 'е');
  if (/о$/i.test(n)) return n.replace(/о$/i, 'е');
  if (/ь$/i.test(n)) return n.replace(/ь$/i, 'и');
  if (/ий$/i.test(n)) return n.replace(/ий$/i, 'ем');
  if (/([бвгджзклмнпрстфхцчшщ])$/i.test(n)) return `${n}е`;
  return n;
}

/** Пригороды / курорты рядом с крупным городом — для сроков дороги. */
const CITY_TRAVEL_ALIAS = [
  { re: /витязев|анап|джемеет|благовещенск.*анап/i, as: 'Анапа' },
  { re: /адлер|сириус/i, as: 'Сочи' },
  { re: /химки|мытищ|подольск|балас|люберц|одинцов/i, as: 'Москва' },
];

function travelCityName(name) {
  const raw = String(name || '');
  for (const a of CITY_TRAVEL_ALIAS) {
    if (a.re.test(raw)) return a.as;
  }
  return raw;
}

/** Грубая зона РФ — для оценки «поезд на сутки / самолёт на пару часов». */
const CITY_REGION = [
  { re: /москв|подмосков|химк|мытищ|подольск/i, region: 'center' },
  { re: /липецк|воронеж|белгород|тул|рязан|калуг|твер|ярослав|владимир|брянск|ор[её]л|курск|смоленск/i, region: 'center' },
  { re: /питер|санкт.?петербург|спб|ленинград/i, region: 'nw' },
  { re: /архангельск|мурманск|вологда|псков|новгород/i, region: 'nw' },
  { re: /калининград/i, region: 'nw_exclave' },
  { re: /нижн|нижегород|казан|самар|уф[аы]|уфа|саратов|пенз|тольятти|ижевск|чебоксар/i, region: 'volga' },
  { re: /краснодар|сочи|анап|витязев|ростов|таганрог|тимашев|ставропол|крым|симферопол|новороссийск|геленджик|туапс|майкоп|донецк|луганск/i, region: 'south' },
  { re: /екатеринбург|екб|курган|челябин|пермь|тюмен|урал/i, region: 'ural' },
  { re: /новосибир|краснояр|омск|томск|барнаул|иркутск|кемеров|новокузнецк/i, region: 'siberia' },
  { re: /владивосток|хабаровск|якутск/i, region: 'far_east' },
];

function cityRegion(name) {
  const n = travelCityName(name);
  for (const c of CITY_REGION) {
    if (c.re.test(n)) return c.region;
  }
  return null;
}

/** Ориентир часов на поезде между зонами (не расписание — чтобы не врать «4 часа через полстраны»). */
const TRAIN_HOURS = {
  'center-center': [3, 10],
  'center-nw': [4, 10],
  'center-volga': [8, 16],
  'center-south': [18, 32],
  'center-ural': [20, 32],
  'center-siberia': [40, 70],
  'center-far_east': [120, 170],
  'center-nw_exclave': [20, 30],
  'nw-south': [24, 40],
  'nw-volga': [14, 24],
  'nw-ural': [28, 40],
  'volga-south': [14, 28],
  'volga-ural': [10, 20],
  'south-south': [3, 12],
  'south-ural': [28, 42],
  'ural-siberia': [20, 36],
  'siberia-far_east': [40, 80],
};

function trainHourBand(fromCity, toCity) {
  const a = cityRegion(fromCity);
  const b = cityRegion(toCity);
  if (!a || !b) return null;
  if (a === b) return TRAIN_HOURS[`${a}-${a}`] || [3, 12];
  const key = [a, b].sort().join('-');
  return TRAIN_HOURS[key] || null;
}

function extractClaimedTravelHours(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (!t.trim()) return null;
  if (/сутки|день\s+пути|сутки\s+с\s+лишним|почти\s+сутки/i.test(t)) return 24;
  const range = t.match(/(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*час/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.max(a, b);
  }
  const num = t.match(/(\d{1,2})\s*час/);
  if (num) {
    const n = Number(num[1]);
    if (Number.isFinite(n)) return n;
  }
  const words = {
    час: 1,
    два: 2,
    две: 2,
    три: 3,
    четыре: 4,
    пять: 5,
    шесть: 6,
    семь: 7,
    восемь: 8,
    девять: 9,
    десять: 10,
    двенадцать: 12,
    пятнадцать: 15,
    двадцать: 20,
  };
  const w = t.match(
    /часа?\s+(два|три|четыре|пять|шесть|семь|восемь|девять|десять)|(?:^|[^\d])(два|три|четыре|пять|шесть|семь|восемь|девять|десять)\s+часа?/,
  );
  if (w) {
    const key = w[1] || w[2];
    if (words[key]) return words[key];
  }
  return null;
}

function isTravelAsk(userMessage) {
  const msg = bare(userMessage);
  if (!msg) return false;
  return (
    /как\s+(?:ты\s+)?(?:добер|доед|попад|доберёш|добереш)/i.test(msg) ||
    /на\s+ч[её]м\s+(?:ты\s+)?(?:ед|поед|попад|лети|добер|доед)/i.test(msg) ||
    /(?:^|\s)(?:добер|доед\w*|попад\w*)(?:ся|ешься|ёшься)?/i.test(msg) ||
    /(?:поезд|самол[её]т|авиа|плацкарт|купе)/i.test(msg) ||
    /сколько\s+(?:час|врем|дорог)|долг[оа]\s+(?:ли\s+)?(?:ед|добер|лет)/i.test(msg) ||
    /когда\s+(?:ты\s+)?(?:при|у)е|во\s+сколько\s+(?:ты\s+)?(?:при|у)е/i.test(msg)
  );
}

function buildTravelDurationHint(card) {
  if (!card?.packing || !card.fromCity || !card.toCity) return null;
  const band = trainHourBand(card.fromCity, card.toCity);
  if (!band) {
    return (
      `ДОРОГА ${card.fromCity} → ${card.toCity}: не выдумывай слишком короткую поездку на поезде через полстраны. ` +
      `Поезд — часто почти сутки или больше; самолёт — обычно 2–4 часа в воздухе. ` +
      `Не путай сроки в соседних репликах.`
    );
  }
  const [lo, hi] = band;
  return (
    `ДОРОГА ${card.fromCity} → ${card.toCity}: на поезде ориентир ${lo}–${hi} ч (часто ночь/сутки), ` +
    `самолётом обычно пару часов лёта + аэропорт. ` +
    `ЗАПРЕЩЕНО писать, что на поезде доедешь за 3–6 часов, если это дальняя дорога (${lo}+ ч). ` +
    `На «как доберёшься / на чём» — реалистично; не спорь сама с собой разными сроками. ` +
    `Не выдумывай точное «завтра / в 21:00 / с Казанского» и не соглашайся, если он подкинул такую дату — в промпте её нет. Говори размыто: «через пару недель», «скоро», «ещё выбираю». Не говори «на днях» про переезд.`
  );
}

/**
 * Карточка из промпта аккаунта (общий разбор, не под один шаблон фразы).
 */
function parsePersonaCard(prompt) {
  const p = String(prompt || '');
  let fromCity = null;
  let toCity = null;

  const move = p.match(
    /жив[её]шь\s+в\s+([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]+).{0,160}?переезжаешь\s+в\s+([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]+)/i,
  );
  if (move) {
    fromCity = move[1];
    toCity = move[2];
  } else {
    // «долго жила в Москве» / «жила в X» / «ещё в Москве» / «Сейчас: Москва → …»
    const single =
      p.match(/жив[её]шь\s+в\s+([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]+)/i) ||
      p.match(/(?:долго\s+)?жил[аеи]?\s+в\s+([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]+)/i) ||
      p.match(/ещё\s+в\s+([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]+)/i) ||
      p.match(/сейчас\s+в\s+([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]+)/i) ||
      p.match(/сейчас\s*:\s*([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]+)\s*→/i) ||
      p.match(/откуда\s+едешь\s*=\s*([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]+)/i) ||
      p.match(/из\s+([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]+).{0,40}?жив/i) ||
      p.match(/из\s+([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]+).{0,80}?переезж/i);
    if (single) fromCity = single[1];
    const dest =
      p.match(/переезжаешь\s+в\s+([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]+)/i) ||
      p.match(/переезд\s+в\s+([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]+)/i) ||
      p.match(/куда\s*=\s*([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]+)/i) ||
      p.match(/→\s*переезд\s+в\s+([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]+)/i) ||
      p.match(/→\s*([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]+)/i);
    if (dest) toCity = dest[1];
  }
  // Падежи → именительный для зон/сравнений.
  const nom = (c) => {
    const s = String(c || '');
    if (/^москв/i.test(s)) return 'Москва';
    if (/^анап/i.test(s)) return 'Анапа';
    if (/^сочи/i.test(s)) return 'Сочи';
    if (/^липецк/i.test(s)) return 'Липецк';
    if (/^тимашевск/i.test(s)) return 'Тимашевск';
    if (/^белгород/i.test(s)) return 'Белгород';
    if (/^краснодар/i.test(s)) return 'Краснодар';
    if (/^нижн/i.test(s)) return 'Нижний Новгород';
    if (/^воронеж/i.test(s)) return 'Воронеж';
    if (/^калуг/i.test(s)) return 'Калуга';
    if (/^курск/i.test(s)) return 'Курск';
    if (/^ростов/i.test(s)) return 'Ростов';
    if (/^самар/i.test(s)) return 'Самара';
    if (/^казан/i.test(s)) return 'Казань';
    return s;
  };
  if (fromCity) fromCity = nom(fromCity);
  if (toCity) toCity = nom(toCity);

  let howLongHere = null;
  const dur = p.match(
    /(?:живу|живёшь|живешь|уже|тут|здесь).{0,40}?(\d+\s*(?:год(?:а|ов)?|лет|месяц(?:а|ев)?|недел[яиь]|дн(?:я|ей|ь)))/i,
  );
  if (dur) howLongHere = dur[1].replace(/\s+/g, ' ').trim();
  else {
    const soft = p.match(
      /(?:недавно|давно|пару\s+лет|несколько\s+лет|с\s+детства|всю\s+жизнь).{0,30}?(?:тут|здесь|в\s+этом\s+город|жив)/i,
    );
    if (soft) howLongHere = soft[0].replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  let name = null;
  const nameM =
    p.match(/тебя\s+зовут\s+([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]*)/i) ||
    p.match(/имя\s*[:\-–]?\s*([А-ЯЁA-Za-z][\wА-Яа-яёЁ\-]*)/i) ||
    p.match(/ты\s+—\s*([А-ЯЁ][а-яё]+)/);
  if (nameM) name = nameM[1];

  const packing = Boolean(toCity && fromCity && !sameCity(fromCity, toCity));

  return {
    fromCity,
    toCity,
    howLongHere,
    name,
    packing,
    knownCities: [fromCity, toCity].filter(Boolean),
  };
}

/** Вопрос про ЕЁ факты: город / откуда / как давно / уже там? (не «зачем переезжаешь» — там своя легенда). */
function isSelfFactQuestion(userMessage) {
  const msg = bare(userMessage);
  if (!msg) return false;
  if (/(?:на\s+)?дв\b|дайвинчик/i.test(msg) && !/в\s+[А-ЯЁа-яё]{3,}/i.test(msg)) {
    return false; // срок на дв — не гео
  }
  // «зачем/почему переезжаешь» — не сюда (objectionHandler WHY_CITY).
  if (/(?:почему|зачем|отчего).{0,40}переез/i.test(msg)) return false;
  return (
    /(?:из\s+какого|откуда\s+ты|ты\s+откуда|где\s+ты|ты\s+где|в\s+каком\s+город|ты\s+из\s+|откуда\s+сама)/i.test(
      msg,
    ) ||
    /(?:как\s+)?(?:давно|скол[ьк]ко(?:\s+уже)?)\s+(?:ты\s+)?(?:уже\s+)?в\s+/i.test(msg) ||
    /(?:ты\s+)?(?:уже\s+)?(?:тут|там|здесь)\s*\??\s*$/i.test(msg) ||
    /(?:ты\s+)?(?:уже\s+)?приехал|ну\s+ты\s+тут/i.test(msg) ||
    /куда\s+(?:ты\s+)?переез|ты\s+переезж/i.test(msg) ||
    /зачем.{0,50}распаков|распаков.{0,40}не\s+приехал/i.test(msg)
  );
}

function extractAskedCity(userMessage) {
  const msg = bare(userMessage);
  if (!msg) return null;
  let m = msg.match(
    /(?:^|\n)(?:а\s+)?(?:ты\s+)?(?:как\s+)?(?:давно|скол[ьк]ко(?:\s+уже)?)\s+в\s+([А-ЯЁа-яё\-]+(?:\s+[А-ЯЁа-яё\-]+)?)/i,
  );
  if (m) return m[1].trim();
  m = msg.match(
    /(?:ты\s+)?(?:сейчас\s+|щас\s+)?в\s+([А-ЯЁа-яё\-]+(?:\s+[А-ЯЁа-яё\-]+)?)\s*\??\s*$/i,
  );
  if (m && msg.split(/\s+/).length <= 10) return m[1].trim();
  return null;
}

/**
 * Хинт в модель: карточка фактов + как отвечать на категорию вопроса.
 */
function buildFactHint(prompt, userMessage, history = []) {
  const card = parsePersonaCard(prompt);
  if (!card.fromCity && !card.toCity) return null;

  const selfQ = isSelfFactQuestion(userMessage);
  const askedCity = extractAskedCity(userMessage);
  const lines = [
    'ФАКТЫ О СЕБЕ (из промпта — не выдумывай другие города/сроки/статус переезда):',
  ];
  if (card.fromCity) lines.push(`• Сейчас ты в ${inCityPrep(card.fromCity)}.`);
  const dayAskLike =
    /(?:как\s+(?:твой\s+)?день|как\s+дела|что\s+делаешь|а\s+у\s+тебя|у\s+тебя\s+как|а\s+ты\s*\??\s*$)/i.test(
      String(userMessage || ''),
    );
  if (card.toCity && card.packing) {
    if (dayAskLike && !selfQ) {
      lines.push(
        `• Переезд в ${card.toCity} — факт на фоне. На «как дела / а у тебя» НЕ пиши про сборы/коробки/«собираю вещи» — ответь мелочью дня (кофе, сериал, дома).`,
      );
    } else {
      lines.push(
        `• Переезжаешь в ${card.toCity}, ещё НЕ там: только сборы/коробки/собираю. ` +
          `Не «распаковываю / разлаживаю / уже разбираю» — это звучит как будто приехала. ` +
          `Не таскай тему сборов в каждый ответ — только если спросили про город/переезд.`,
      );
    }
  }
  if (card.howLongHere) {
    lines.push(`• Срок в текущем городе (ориентир): ${card.howLongHere}.`);
  } else {
    lines.push(
      '• Точного «живу N лет» в промпте нет — на «как давно» отвечай размыто («не так давно)», «уже какое-то время)»), без выдуманных цифр.',
    );
  }
  lines.push(
    'На вопросы «из какого города / где ты / как давно / уже приехала» отвечай ТОЛЬКО по этой карточке. ' +
      'Не зеркаль «а ты там живёшь?». Не подставляй его город как свой.',
  );
  if (card.fromCity) {
    lines.push(
      `ЗАПРЕЩЕНО про ${card.fromCity}: «давно не была», «давно там не была», «уже давно не была» — ты СЕЙЧАС там живёшь. ` +
        `На комплимент городу — коротко согласись / «пока тут)», без «давно не была».`,
    );
  }
  if (/радужн/i.test(String(card.toCity || '')) || /радужн/i.test(String(card.fromCity || ''))) {
    lines.push(
      'Радужный — ГОРОД (ХМАО), не радуга в небе. Не пиши «обожаю радугу / слабость радуга».',
    );
  }

  if (askedCity) {
    if (card.toCity && sameCity(askedCity, card.toCity) && card.packing) {
      lines.push(
        `Он спросил про ${askedCity} (= куда едешь): скажи что ещё не там / собираюсь / скоро, не что уже живёшь.`,
      );
    } else if (card.fromCity && sameCity(askedCity, card.fromCity)) {
      lines.push(
        `Он спросил про ${askedCity} (= твой текущий): ответь про себя там` +
          (card.howLongHere ? ` (срок ≈ ${card.howLongHere})` : ' (без точных цифр из воздуха)') +
          '.',
      );
    } else if (card.knownCities.length) {
      lines.push(
        `Город «${askedCity}» не твой текущий и не пункт переезда — не подтверждай что ты там живёшь.`,
      );
    }
  }

  const travelAsk = isTravelAsk(userMessage);
  const travelHint = buildTravelDurationHint(card);
  if (travelHint && (selfQ || travelAsk)) {
    lines.push(travelHint);
  }

  if (!selfQ && !travelAsk) return null;
  return lines.join(' ');
}

const UNPACK_RE =
  /распаков\w*|разлажив\w*|разбираю\s+(?:вещи|короб)|вещи\s+разлаж|коробк\w*\s+разбира/i;
const ARRIVED_CLAIM_RE =
  /уже\s+(?:тут|там|приехал|доехал)|переехал[аи]?\s+в|приехал[аи]?\s+в|живу\s+уже\s+в|улетел[аи]?|вылетел[аи]?|уже\s+в\s+пути|в\s+самол[её]те|на\s+борту/i;
const USER_CATCH_UNPACK_RE =
  /зачем.{0,60}распаков|распаков.{0,50}(?:если|а\s+ещё)|(?:ещё\s+)?не\s+приехал.{0,40}(?:короб|распаков)/i;

/**
 * Постфильтр: ответ не должен ломать карточку фактов.
 * Категории: статус переезда, город, срок — не точечные фразы.
 */
function groundReply(reply, userMessage, history, prompt) {
  if (!reply) return reply;
  const card = parsePersonaCard(prompt);
  let text = String(reply).trim();
  const user = bare(userMessage);
  const histAsst = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'assistant')
    .slice(-10)
    .map((h) => String(h.content || ''))
    .join('\n');

  // 1) Поймали «распаковку до приезда» — признать оговорку.
  if (USER_CATCH_UNPACK_RE.test(user)) {
    if (
      /заранее|потом\s+придётся|подготов|всё\s+равно\s+придётся|распаков|разлаж/i.test(text) ||
      text.length < 180
    ) {
      return [
        'ой собираю имела в виду)',
        'хах да собираю просто, язык заплёлся)',
        'ну собираю коробки да)',
      ][Math.floor(Math.random() * 3)];
    }
  }

  // 1b) «улетела / уже в пути» пока packing — рано.
  if (
    card.packing &&
    /улетел[аи]?|вылетел[аи]?|уже\s+в\s+пути|в\s+самол[её]те|на\s+борту|лечу\s+(?:сейчас|уже)/i.test(
      text,
    ) &&
    !/время\s+улетел/i.test(text)
  ) {
    return [
      'ещё нет, через пару недель)',
      'пока сборы, не уехала)',
      'собираюсь, но ещё тут)',
    ][Math.floor(Math.random() * 3)];
  }

  // 2) Распаковка, пока packing — → сборы.
  if (card.packing && UNPACK_RE.test(text)) {
    const arrivedInHist =
      ARRIVED_CLAIM_RE.test(histAsst) && !/ещё\s+в\s+|собираюсь\s+в\s+/i.test(histAsst.slice(-240));
    if (!arrivedInHist) {
      const rewritten = text
        .replace(/коробки\s+распаковываю/gi, 'коробки собираю')
        .replace(/распаковываю/gi, 'собираю')
        .replace(/распаковала/gi, 'собрала')
        .replace(/распаковывала/gi, 'собирала')
        .replace(/распаковк\w*/gi, 'сборы')
        .replace(/разлаживаю/gi, 'складываю')
        .replace(/разложила/gi, 'сложила')
        .replace(/разбираю\s+коробк\w*/gi, 'собираю коробки');
      text =
        rewritten !== text && !UNPACK_RE.test(rewritten)
          ? rewritten
          : ['собираю вещи потихоньку)', 'с коробками вожусь)', 'сборы, коробки)'][
              Math.floor(Math.random() * 3)
            ];
    }
  }

  // 3) «Как давно в DEST?» / «ты уже там?» → ещё не.
  const asked = extractAskedCity(userMessage);
  if (
    card.packing &&
    card.toCity &&
    ((asked && sameCity(asked, card.toCity)) ||
      /(?:ты\s+)?(?:уже\s+)?(?:тут|там|приехал)|ну\s+ты\s+тут/i.test(user))
  ) {
    if (
      ARRIVED_CLAIM_RE.test(text) ||
      (/живу\s+в\s+/i.test(text) && sameCity(text.match(/живу\s+в\s+([А-ЯЁа-яё\-]+)/i)?.[1], card.toCity)) ||
      (UNPACK_RE.test(String(reply)) && !/ещё\s+не|собира/i.test(text))
    ) {
      return [
        `ещё нет, собираюсь в ${inCityAcc(card.toCity)})`,
        `пока в ${inCityPrep(card.fromCity)}, в ${inCityAcc(card.toCity)} только еду)`,
        `не приехала ещё, сборы)`,
      ][Math.floor(Math.random() * 3)];
    }
  }

  // 4) «Как давно в CURRENT?» — не выдумывать чужие годы.
  if (
    asked &&
    card.fromCity &&
    sameCity(asked, card.fromCity) &&
    /(?:как\s+)?(?:давно|скол[ьк]ко)/i.test(user)
  ) {
    const inventedYears = text.match(/(\d+)\s*(?:год(?:а|ов)?|лет)/i);
    if (inventedYears && card.howLongHere) {
      if (!card.howLongHere.includes(inventedYears[1])) {
        return [
          `ну ${card.howLongHere} примерно)`,
          `да ${card.howLongHere} уже)`,
          `хм ${card.howLongHere})`,
        ][Math.floor(Math.random() * 3)];
      }
    } else if (inventedYears && !card.howLongHere) {
      return ['не так давно уже)', 'уже какое-то время)', 'ну давновато)'][
        Math.floor(Math.random() * 3)
      ];
    }
  }

  // 5) «а в DEST просто надо» после «к маме» — город и мама одна причина
  // (раньше голого «я в DEST», иначе «в Белгороде просто надо» уходило в «ещё в from»).
  if (
    card.toCity &&
    /мама|мам[ауе]|поддержк/i.test(String(prompt || '') + '\n' + histAsst) &&
    (sameCity(text.match(/в\s+([А-ЯЁа-яё\-]+)/i)?.[1], card.toCity) ||
      new RegExp(cityStem(card.toCity), 'i').test(text)) &&
    /просто\s+надо|ну\s+надо|просто\s+так|хм,?\s+просто/i.test(text)
  ) {
    return [
      `к маме в ${inCityAcc(card.toCity)}, ей нужна поддержка)`,
      `ну к маме в ${inCityAcc(card.toCity)} еду)`,
      `маме в ${inCityPrep(card.toCity)} поддержка нужна)`,
    ][Math.floor(Math.random() * 3)];
  }

  // 6) Голый «я в DEST» как будто уже живёт — к текущему + переезд.
  // Только если он реально спросил про город/переезд (не «какие сериалы?»).
  const locAsk =
    /(?:где\s+ты|ты\s+где|из\s+какого|в\s+каком\s+город|како(?:й|м)\s+город|город(?:е|а)?\b|переезд|жив[её]шь|откуда\s+ты|ты\s+там\b|уже\s+там|как\s+давно\s+в|ты\s+в\s+[А-ЯЁа-яё]{3,}|уже\s+приехал)/i.test(
      user,
    );
  if (locAsk && card.packing && card.fromCity && card.toCity) {
    const claim =
      text.match(/(?:я\s+)?(?:сейчас\s+|щас\s+)?в\s+([А-ЯЁа-яё\-]+(?:\s+[А-ЯЁа-яё\-]+)?)/i) ||
      text.match(/живу\s+в\s+([А-ЯЁа-яё\-]+(?:\s+[А-ЯЁа-яё\-]+)?)/i);
    if (
      claim &&
      sameCity(claim[1], card.toCity) &&
      !/переезж|поеду|еду\s+в|собираюсь|маме|мама/i.test(text) &&
      !/сериал|фильм|телефон|музык|игр/i.test(claim[1])
    ) {
      return [
        `пока в ${inCityPrep(card.fromCity)}, в ${inCityAcc(card.toCity)} переезжаю)`,
        `ещё в ${inCityPrep(card.fromCity)}) в ${inCityAcc(card.toCity)} поеду`,
      ][Math.floor(Math.random() * 2)];
    }
  }

  // 6b) «давно не была в CURRENT» / «давно там не была» про город, где СЕЙЧАС —
  // (баг: «сейчас в Липецке» → «миленький, но давно не была там»).
  if (card.fromCity) {
    const absentHere =
      /давно\s+не\s+был[аи]?\s+(?:там|тут|здесь)|не\s+был[аи]?\s+там\s+давно|давно\s+там\s+не\s+был[аи]?/i.test(
        text,
      ) ||
      new RegExp(
        `давно\\s+не\\s+был[аи]?\\s+в\\s+${cityStem(card.fromCity)}\\w*`,
        'i',
      ).test(text);
    const talksAboutHere =
      sameCity(extractAskedCity(userMessage), card.fromCity) ||
      new RegExp(cityStem(card.fromCity), 'i').test(user) ||
      new RegExp(cityStem(card.fromCity), 'i').test(histAsst.slice(-400)) ||
      /миленьк|милый\s+город|классн\w*\s+город|уютн/i.test(user);
    if (absentHere && talksAboutHere) {
      return [
        `да) пока ещё в ${inCityPrep(card.fromCity)} живу`,
        `ага) я как раз тут сейчас)`,
        `ну да) пока живу в ${inCityPrep(card.fromCity)}`,
      ][Math.floor(Math.random() * 3)];
    }
  }

  // 7) Ещё не переехала — мама НЕ «рядом/шумит дома».
  // Если едет к маме: мама уже в toCity; физически рядом — только после приезда.
  const MOM_PHYS_NEAR_RE =
    /мама\s+(?:рядом|дома|шумит|ор[её]т|кричит|мешает|фонит|в\s+комнат|на\s+кухн|сидит)|рядом\s+мама|с\s+мамой\s+(?:дома|сейчас|рядом)|маме?\s+шумит|мама\s+тут/i;
  const momMoveStory =
    /мама|мам[ауе]/i.test(String(prompt || '') + '\n' + histAsst) &&
    Boolean(card.toCity) &&
    Boolean(card.packing);
  if (momMoveStory && MOM_PHYS_NEAR_RE.test(text)) {
    const whoAsk = /кто\s+там|кто\s+ходит|кто\s+шум|у\s+тебя\s+кто/i.test(user);
    const saidNeighbors = /сосед/i.test(histAsst);
    if (whoAsk || saidNeighbors) {
      return [
        'ахаха это соседи просто)',
        'да соседи гуляют)',
        'хах соседи сверху)',
      ][Math.floor(Math.random() * 3)];
    }
    return [
      'хах связь просто барахлит)',
      'да наушники глючат)',
      'маме писала только, сама дома)',
    ][Math.floor(Math.random() * 3)];
  }

  // 8) Срок дороги: не «поезд Москва→юг за 4 часа».
  text = groundTravelDuration(text, card, user);

  // 9) Не соглашаться на выдуманный рейс/дату, которой нет в промпте
  // («Поезд завтра, ты же помнишь?» → «да, завтра уже в пути»).
  text = groundInventedTravelSchedule(text, user, card, prompt);

  return text;
}

/**
 * Собеседник подкинул «завтра поезд / с Казанского / в 21:00» —
 * не подтверждать как факт, если в промпте нет такой даты/рейса.
 */
function groundInventedTravelSchedule(text, userMessage, card, prompt) {
  if (!card?.packing) return text;
  const user = bare(userMessage);
  const p = String(prompt || '');
  const peerPlantsSchedule =
    /(?:поезд|самол[её]т|рейс).{0,40}(?:завтра|послезавтра|сегодня\s+в\s+\d)|(?:завтра|послезавтра).{0,40}(?:поезд|самол[её]т|рейс|в\s+пути)|ты\s+(?:де\s+)?помнишь|вокзал|казанск|курск|ленинградск|ярославск|киевск|павелецк/i.test(
      user,
    );
  const weAffirm =
    /(?:^|[^а-яё])(?:да|ага|точно|конечно|помню|угу).{0,40}(?:завтра|послезавтра|в\s+пути|поезд|рейс|вокзал)|завтра\s+уже\s+в\s+пути|поезд\s+вечером|около\s+\d{1,2}|с\s+\w*вокзал/i.test(
      text,
    );
  const promptHasDate =
    /завтра|послезавтра|вокзал|казанск|в\s+\d{1,2}\s*:\s*\d{2}|рейс\s+\d/i.test(p);

  if (peerPlantsSchedule && weAffirm && !promptHasDate) {
    return [
      'хм даты ещё плывут, ближе скажу)',
      'точно пока не фиксировала, через пару недель)',
      'ну билет ещё выбираю, не завтра жёстко)',
    ][Math.floor(Math.random() * 3)];
  }

  // Сама выдумала точное время/вокзал без запроса факта из промпта.
  if (
    !promptHasDate &&
    /поезд\s+вечером|около\s+\d{1,2}(?!\s*-\s*\d)|с\s+\w*вокзал|завтра\s+уже\s+в\s+пути|завтра\s+приед/i.test(
      text,
    )
  ) {
    return [
      'ну через пару недель, точное время ещё смотрю)',
      'скоро, без точного часа пока)',
      'ближе к делу скажу, ещё выбираю)',
    ][Math.floor(Math.random() * 3)];
  }

  return text;
}

function groundTravelDuration(text, card, userMessage = '') {
  if (!card?.packing || !card.fromCity || !card.toCity) return text;
  const band = trainHourBand(card.fromCity, card.toCity);
  if (!band) return text;
  const [lo] = band;
  if (lo < 12) return text; // ближние пары не трогаем

  const hours = extractClaimedTravelHours(text);
  if (hours == null) return text;

  const byTrain = /поезд|плацкарт|купе|электрич/i.test(text);
  const byPlane = /самол[её]т|авиа|рейс|лечу|лететь/i.test(text);
  const travelTalk =
    byTrain ||
    byPlane ||
    /поеду|еду\s+в|добер|добира|на\s+чём|на\s+чем|часа\s+четыре|не\s+очень\s+долго/i.test(text) ||
    isTravelAsk(userMessage);

  if (!travelTalk) return text;

  // Самолёт: 2–4 ч ок; поезд с «коротким» сроком на дальнюю дорогу — нет.
  if (byPlane && hours <= 6) return text;
  if (hours >= lo * 0.7) return text; // уже в разумном диапазоне поезда
  if (!byTrain && hours >= 12) return text; // «сутки» без слова поезд — ок

  // Слишком коротко для поезда / «часа четыре» на юг.
  if (hours <= Math.min(10, Math.floor(lo * 0.45))) {
    return [
      `на поезде долго, почти сутки, самолётом быстрее)`,
      `поездом долго ехать, часа ${Math.round((lo + band[1]) / 2)} примерно, или самолётом)`,
      `ой на поезде дольше выходит, лучше самолётом пару часов)`,
    ][Math.floor(Math.random() * 3)];
  }
  return text;
}

module.exports = {
  parsePersonaCard,
  isSelfFactQuestion,
  extractAskedCity,
  buildFactHint,
  buildTravelDurationHint,
  groundReply,
  groundTravelDuration,
  groundInventedTravelSchedule,
  trainHourBand,
  extractClaimedTravelHours,
  isTravelAsk,
  sameCity,
  cityStem,
  inCityPrep,
  inCityAcc,
};
