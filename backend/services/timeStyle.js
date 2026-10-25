/**
 * ДИНАМИЧЕСКИЙ ТАЙМ-МЕНЕДЖМЕНТ.
 * Периоды и часы можно переопределить через .env.
 */

const CONFIG = {
  wakeUpStart: Number(process.env.WAKE_UP_START) || 6,
  wakeUpEnd: Number(process.env.WAKE_UP_END) || 10,
  goingToBedStart: Number(process.env.GOING_TO_BED_START) || 23,
  goingToBedEnd: Number(process.env.GOING_TO_BED_END) || 6,
};

const WORK_TIMEZONE = process.env.WORK_TIMEZONE || 'Europe/Moscow';

function getMoscowTimeParts() {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: WORK_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  return { hour: hour % 24, minute };
}

/** Кофе уместен утром/днём (07–18 МСК), вечером/ночью — нет. */
function isCoffeeOkHourMsk(hour) {
  const h =
    hour === undefined || hour === null ? getMoscowTimeParts().hour : Number(hour);
  const n = Number.isFinite(h) ? ((h % 24) + 24) % 24 : getMoscowTimeParts().hour;
  return n >= 7 && n < 18;
}

function isEveningOrNightMsk(hour) {
  return !isCoffeeOkHourMsk(hour);
}

/** Сб/вс по Москве. */
function isWeekendMsk(date = new Date()) {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: WORK_TIMEZONE,
    weekday: 'short',
  }).format(date);
  return wd === 'Sat' || wd === 'Sun';
}

/**
 * Реальное время года по календарю (МСК).
 * Зима: дек–фев, весна: мар–май, лето: июн–авг, осень: сен–ноя.
 */
function getSeasonInfo(date = new Date()) {
  const month = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: WORK_TIMEZONE,
      month: 'numeric',
    }).format(date),
  );
  const day = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: WORK_TIMEZONE,
      day: 'numeric',
    }).format(date),
  );
  const year = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: WORK_TIMEZONE,
      year: 'numeric',
    }).format(date),
  );

  let id = 'autumn';
  let nameRu = 'осень';
  let nameEn = 'autumn';
  if (month === 12 || month <= 2) {
    id = 'winter';
    nameRu = 'зима';
    nameEn = 'winter';
  } else if (month >= 3 && month <= 5) {
    id = 'spring';
    nameRu = 'весна';
    nameEn = 'spring';
  } else if (month >= 6 && month <= 8) {
    id = 'summer';
    nameRu = 'лето';
    nameEn = 'summer';
  }

  const monthNamesRu = [
    '',
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ];
  const monthRu = monthNamesRu[month] || '';

  const hint =
    `Сейчас по календарю (МСК): ${day} ${monthRu} ${year}, время года — ${nameRu}. ` +
    `Используй ТОЛЬКО это время года. Не упоминай другие сезоны просто так. ` +
    `Слово «солнце» ≠ весна. Поправляй сезон ТОЛЬКО если он ЯВНО написал неверный ` +
    `(«весна»/«лето»/«зима» не в тему) — одной короткой фразой. Не выдумывай, что он сказал «весна».`;

  return { id, nameRu, nameEn, month, day, year, monthRu, hint };
}

function weekendOverlay(periodId) {
  if (!isWeekendMsk()) return '';
  if (periodId === 'work') {
    return (
      ' Сегодня выходной: это НЕ рабочий урывками-режим. Пиши спокойнее и свободнее, ' +
      'как дома / в ленивый день — без «на работе между делами».'
    );
  }
  if (periodId === 'wake_up') {
    return ' Выходное утро: можно встать позже по сюжету, ещё ленивее и соннее обычного будня.';
  }
  if (periodId === 'mid_day') {
    return ' Выходной день: больше быта/отдыха, можно чуть разговорнее; без офисного тона.';
  }
  if (periodId === 'social_evening') {
    return ' Выходной вечер: самый живой режим — можно чуть теплее и с инициативой, без допроса.';
  }
  return ' Выходной: темп свободнее, чем в будни.';
}

function normalizeHour(hour) {
  const value = Number(hour);
  return Number.isFinite(value) ? ((value % 24) + 24) % 24 : getMoscowTimeParts().hour;
}

function toPeriodHour(hour, start) {
  const h = normalizeHour(hour);
  return start > 12 && h < start - 12 ? h + 24 : h;
}

function bedDelayMultiplier(hour) {
  const start = CONFIG.goingToBedStart;
  const end = CONFIG.goingToBedEnd < start ? CONFIG.goingToBedEnd + 24 : CONFIG.goingToBedEnd;
  const h = toPeriodHour(hour, start);
  const peak = start + (end - start) * 0.4;

  let depth;
  if (h <= peak) {
    depth = (h - start) / (peak - start);
  } else {
    depth = 1 - ((h - peak) / (end - peak)) * 0.7;
  }

  depth = Math.max(0, Math.min(1, depth));
  return +(1.2 + depth * 2.8).toFixed(2);
}

function wakeDelayMultiplier(hour) {
  const depth = Math.max(
    0,
    Math.min(1, (normalizeHour(hour) - CONFIG.wakeUpStart) / (CONFIG.wakeUpEnd - CONFIG.wakeUpStart)),
  );
  return +(2.5 - depth * 1.7).toFixed(2);
}

const PERIODS = [
  {
    id: 'wake_up',
    from: CONFIG.wakeUpStart,
    to: CONFIG.wakeUpEnd,
    delayMultiplier: null,
    hint:
      `Сейчас раннее утро (${CONFIG.wakeUpStart}:00-${CONFIG.wakeUpEnd}:00). ` +
      'Ты только проснулась и ещё сонная. Отвечай коротко, немного медленнее, без эссе. ' +
      'Можно «ещё сплю глазами», но не описывай каждый чих. ' +
      'Не говори о кофе автоматически: упоминай его максимум один раз за всё утро и только если к месту. ' +
      'После упоминания кофе больше не возвращайся к этой теме до следующего дня. ' +
      'Не повторяй одну и ту же бытовую деталь в соседних сообщениях.',
  },
  {
    id: 'work',
    from: CONFIG.wakeUpEnd,
    to: 14,
    delayMultiplier: 0.6,
    hint:
      `Сейчас «рабочее» время (${CONFIG.wakeUpEnd}:00-14:00). Отвечай быстро и по делу, короткими фразами, ` +
      'как будто пишешь урывками между делами. Иногда одна строка без вопроса.',
  },
  {
    id: 'mid_day',
    from: 14,
    to: 18,
    delayMultiplier: 1,
    hint:
      'Сейчас день (14:00-18:00). Обычный темп: живая короткая реакция, без режима «саппорт».',
  },
  {
    id: 'social_evening',
    from: 18,
    to: CONFIG.goingToBedStart,
    delayMultiplier: 0.5,
    hint:
      `Сейчас вечер (18:00-${CONFIG.goingToBedStart}:00) — самое живое время. ` +
      'Можно чуть теплее и с инициативой, но почти без эмодзи и без допроса «а ты?».',
  },
  {
    id: 'going_to_bed',
    from: CONFIG.goingToBedStart,
    to: CONFIG.goingToBedEnd,
    delayMultiplier: null,
    nightDelayRangeMs: [10 * 60 * 1000, 30 * 60 * 1000],
    hint:
      `Сейчас ночь (${CONFIG.goingToBedStart}:00-${CONFIG.goingToBedEnd}:00). ` +
      'Ты спишь. Если всё же отвечаешь — явно сонная, вялая, очень коротко (2–6 слов).',
  },
];

function getTimeStyle(hour, accountId) {
  const currentTime = getMoscowTimeParts();
  const h = hour === undefined || hour === null ? currentTime.hour : normalizeHour(hour);
  const season = getSeasonInfo();
  const exactTimeHint =
    `Текущее время по Москве: ${String(currentTime.hour).padStart(2, '0')}:${String(currentTime.minute).padStart(2, '0')}. ` +
    `Если спрашивают время или ты сама его упоминаешь, используй именно это время. ${season.hint}`;
  for (const period of PERIODS) {
    const inRange = period.from <= period.to
      ? h >= period.from && h < period.to
      : h >= period.from || h < period.to;
    if (inRange) {
      const delayMultiplier = period.id === 'going_to_bed'
        ? bedDelayMultiplier(h)
        : period.id === 'wake_up'
          ? wakeDelayMultiplier(h)
          : period.delayMultiplier;
      const eveningGuard = period.id === 'social_evening' || period.id === 'going_to_bed'
        ? ' Сейчас вечер или ночь: ЗАПРЕЩЕНО писать что пьёшь/варишь кофе («кофе пью», «с кофейком»). ' +
          'Не говори, что только проснулась или начинаешь утро. Вечером лучше чай / телефон / сериал / дела.'
        : '';
      // Обратная защита: утром и днём нельзя прощаться на ночь. Модель читает
      // вчерашнюю ночную переписку и зеркалит «споки» в 11 утра.
      const dayGuard = ['wake_up', 'work', 'mid_day'].includes(period.id)
        ? ' Сейчас светлое время суток: НЕ прощайся на ночь — никаких «спокойной ночи», «споки», ' +
          '«сладких снов», «пойду спать». Если он ночью желал спокойной ночи, ответь по-утреннему ' +
          'или просто по делу.'
        : '';
      const weekendHint = weekendOverlay(period.id);
      // В выходные «рабочий» слот не ускоряем как будничный офис.
      let delayMultiplierFinal = delayMultiplier;
      if (isWeekendMsk() && period.id === 'work') {
        delayMultiplierFinal = 1;
      }
      let onlineFlavor = '';
      if (accountId != null && accountId !== '') {
        try {
          const { getOnlineFlavor } = require('./lifeTexture');
          onlineFlavor = ` ${getOnlineFlavor(accountId, period.id)}`;
        } catch (_) {
          /* optional */
        }
      }
      return {
        ...period,
        hint: `${exactTimeHint} ${period.hint}${eveningGuard}${dayGuard}${weekendHint}${onlineFlavor}`,
        delayMultiplier: delayMultiplierFinal,
        isWeekend: isWeekendMsk(),
        isNight: period.id === 'going_to_bed',
        isSleep: period.id === 'going_to_bed',
        isWakeUp: period.id === 'wake_up',
        season,
      };
    }
  }
  return {
    id: 'mid_day',
    hint: exactTimeHint,
    delayMultiplier: 1,
    isNight: false,
    isSleep: false,
    isWakeUp: false,
    season,
  };
}

module.exports = {
  getTimeStyle,
  getSeasonInfo,
  CONFIG,
  isWeekendMsk,
  getMoscowTimeParts,
  isCoffeeOkHourMsk,
  isEveningOrNightMsk,
};
