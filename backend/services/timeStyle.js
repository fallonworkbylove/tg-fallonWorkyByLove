/**
 * ДИНАМИЧЕСКИЙ ТАЙМ-МЕНЕДЖМЕНТ.
 *
 * Стиль ответа бота подстраивается под текущее время суток (по таймзоне
 * рабочих часов бота, см. WORK_TIMEZONE в telegramClient.js). Здесь — только
 * чистая функция, которая возвращает текстовую подсказку для промпта и
 * множитель к обычной паузе перед ответом. Реального решения «отвечать или
 * не отвечать ночью» этот модуль не принимает — это делает существующая
 * логика рабочих часов (WORK_START_HOUR/WORK_END_HOUR) в telegramClient.js.
 */

const PERIODS = [
  {
    id: 'sleepy_morning',
    from: 6,
    to: 10,
    delayMultiplier: 1.6,
    hint:
      'Сейчас раннее утро (6:00-10:00). Ты только встала, сонная, пьёшь кофе. ' +
      'Отвечай чуть медленнее и вяло, короткими фразами, можно упомянуть, что только ' +
      'проснулась или пьёшь кофе — но не в каждом сообщении, только если естественно.',
  },
  {
    id: 'work',
    from: 10,
    to: 14,
    delayMultiplier: 0.6,
    hint:
      'Сейчас рабочее время (10:00-14:00). Отвечай быстро и по делу, короткими фразами, ' +
      'как будто пишешь урывками между делами на работе.',
  },
  {
    id: 'mid_day',
    from: 14,
    to: 18,
    delayMultiplier: 1,
    hint:
      'Сейчас дневное время (14:00-18:00), обычная средняя активность. Отвечай в среднем ' +
      'темпе, без спешки и без сонливости.',
  },
  {
    id: 'social_evening',
    from: 18,
    to: 23,
    delayMultiplier: 0.5,
    hint:
      'Сейчас вечер (18:00-23:00) — самое общительное время суток. Отвечай быстро и живее, ' +
      'можно чуть больше эмодзи и инициативы в разговоре.',
  },
  {
    id: 'night',
    from: 23,
    to: 6,
    delayMultiplier: 3,
    nightDelayRangeMs: [10 * 60 * 1000, 30 * 60 * 1000],
    hint:
      'Сейчас глубокая ночь (23:00-6:00). Ты спишь. Если всё же отвечаешь — отвечай явно ' +
      'сонным, вялым тоном, очень коротко, можно упомянуть, что разбудили или что засыпаешь.',
  },
];

/**
 * Возвращает описание стиля для текущего часа (или переданного объекта Date).
 * @returns {{id: string, hint: string, delayMultiplier: number, isNight: boolean, nightDelayRangeMs?: [number, number]}}
 */
function getTimeStyle(hour) {
  const h = typeof hour === 'number' ? hour : new Date().getHours();
  for (const period of PERIODS) {
    const inRange =
      period.from <= period.to
        ? h >= period.from && h < period.to
        : h >= period.from || h < period.to; // диапазон через полночь (ночь)
    if (inRange) {
      return { ...period, isNight: period.id === 'night' };
    }
  }
  return { id: 'mid_day', hint: '', delayMultiplier: 1, isNight: false };
}

module.exports = { getTimeStyle };
