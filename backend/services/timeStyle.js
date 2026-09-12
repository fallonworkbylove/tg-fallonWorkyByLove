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
      'Ты только проснулась и ещё сонная. Отвечай коротко, немного медленнее и без постоянного описания своих действий. ' +
      'Не говори о кофе автоматически: упоминай его максимум один раз за всё утро и только если это естественно связано с разговором. ' +
      'После упоминания кофе больше не возвращайся к этой теме до следующего дня. ' +
      'Не повторяй одну и ту же бытовую деталь в соседних сообщениях.',
  },
  {
    id: 'work',
    from: CONFIG.wakeUpEnd,
    to: 14,
    delayMultiplier: 0.6,
    hint:
      `Сейчас рабочее время (${CONFIG.wakeUpEnd}:00-14:00). Отвечай быстро и по делу, короткими фразами, ` +
      'как будто пишешь урывками между делами на работе.',
  },
  {
    id: 'mid_day',
    from: 14,
    to: 18,
    delayMultiplier: 1,
    hint: 'Сейчас дневное время (14:00-18:00), обычная средняя активность. Отвечай в среднем темпе.',
  },
  {
    id: 'social_evening',
    from: 18,
    to: CONFIG.goingToBedStart,
    delayMultiplier: 0.5,
    hint:
      `Сейчас вечер (18:00-${CONFIG.goingToBedStart}:00) — самое общительное время суток. ` +
      'Отвечай быстро и живее, можно чуть больше эмодзи и инициативы в разговоре.',
  },
  {
    id: 'going_to_bed',
    from: CONFIG.goingToBedStart,
    to: CONFIG.goingToBedEnd,
    delayMultiplier: null,
    nightDelayRangeMs: [10 * 60 * 1000, 30 * 60 * 1000],
    hint:
      `Сейчас ночь (${CONFIG.goingToBedStart}:00-${CONFIG.goingToBedEnd}:00). ` +
      'Ты спишь. Если всё же отвечаешь — отвечай явно сонным, вялым тоном, очень коротко.',
  },
];

function getTimeStyle(hour) {
  const currentTime = getMoscowTimeParts();
  const h = normalizeHour(hour);
  const exactTimeHint = `Текущее время по Москве: ${String(currentTime.hour).padStart(2, '0')}:${String(currentTime.minute).padStart(2, '0')}. Если спрашивают время или ты сама его упоминаешь, используй именно это время.`;
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
        ? ' Сейчас вечер или ночь: не говори, что только проснулась, пьёшь кофе или начинаешь утро.'
        : '';
      return {
        ...period,
        hint: `${exactTimeHint} ${period.hint}${eveningGuard}`,
        delayMultiplier,
        isNight: period.id === 'going_to_bed',
        isSleep: period.id === 'going_to_bed',
        isWakeUp: period.id === 'wake_up',
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
  };
}

module.exports = { getTimeStyle, CONFIG };
