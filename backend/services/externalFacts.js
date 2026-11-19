/**
 * Whitelist-факты для ответов: курс BTC + локальное время города из промпта.
 * Без общего web-search — только явные триггеры в реплике собеседника.
 */

const CITY_TZ = [
  { re: /москв/i, tz: 'Europe/Moscow', label: 'Москве' },
  { re: /питер|санкт.?петербург|спб/i, tz: 'Europe/Moscow', label: 'Питере' },
  { re: /казан/i, tz: 'Europe/Moscow', label: 'Казани' },
  { re: /сочи/i, tz: 'Europe/Moscow', label: 'Сочи' },
  { re: /краснодар/i, tz: 'Europe/Moscow', label: 'Краснодаре' },
  { re: /белгород/i, tz: 'Europe/Moscow', label: 'Белгороде' },
  { re: /донецк/i, tz: 'Europe/Moscow', label: 'Донецке' },
  { re: /ростов/i, tz: 'Europe/Moscow', label: 'Ростове' },
  { re: /воронеж/i, tz: 'Europe/Moscow', label: 'Воронеже' },
  { re: /екатеринбург|екб/i, tz: 'Asia/Yekaterinburg', label: 'Екатеринбурге' },
  { re: /новосибир/i, tz: 'Asia/Novosibirsk', label: 'Новосибирске' },
  { re: /владивосток/i, tz: 'Asia/Vladivostok', label: 'Владивостоке' },
  { re: /калининград/i, tz: 'Europe/Kaliningrad', label: 'Калининграде' },
  { re: /минск/i, tz: 'Europe/Minsk', label: 'Минске' },
  { re: /киев|київ/i, tz: 'Europe/Kyiv', label: 'Киеве' },
  { re: /алмат|алма.?ат/i, tz: 'Asia/Almaty', label: 'Алматы' },
  { re: /ташкент/i, tz: 'Asia/Tashkent', label: 'Ташкенте' },
  { re: /дубай/i, tz: 'Asia/Dubai', label: 'Дубае' },
  { re: /стамбул/i, tz: 'Europe/Istanbul', label: 'Стамбуле' },
];

const BTC_ASK_RE =
  /(?:курс|цена|сколько\s+(?:стоит|сейчас))\s*(?:битк|биток|биткоин|\bbtc\b)|(?:битк|биток|биткоин|\bbtc\b).{0,20}(?:курс|цена|сколько)|эфир(?:иум)?|\beth\b/i;

// «сколько время?» / «у тебя сколько время» / «сколько времени» — все варианты.
const TIME_ASK_RE =
  /(?:который|какое|какой)\s+час|(?:у\s+тебя\s+)?скол[ьк]ко\s+(?:у\s+тебя\s+)?(?:сейчас\s+)?врем(?:я|ени)|(?:который|какой)\s+час\s+у\s+тебя|время\s+у\s+тебя|(?:у\s+тебя\s+)?сейчас\s+скол[ьк]ко\s+врем(?:я|ени)|скол[ьк]ко\s+(?:сейчас\s+)?времени\s+у\s+тебя|у\s+тебя\s+скол[ьк]ко\s+врем(?:я|ени)|what\s+time\s+is\s+it|what'?s\s+the\s+time/i;

let btcCache = { at: 0, usd: null };

function extractCityFromPrompt(prompt) {
  const text = String(prompt || '');
  for (const c of CITY_TZ) {
    if (c.re.test(text)) return c;
  }
  // «живу в X» / «город: X»
  const m = text.match(
    /(?:живу|сейчас\s+в|город\s*[:\-–]|из\s+города)\s+([А-ЯЁA-Z][а-яёa-z\-]+)/,
  );
  if (m) {
    const name = m[1];
    for (const c of CITY_TZ) {
      if (c.re.test(name)) return c;
    }
    return { re: null, tz: 'Europe/Moscow', label: name };
  }
  return null;
}

function formatCityClock(tz) {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: tz || 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  } catch (_) {
    return null;
  }
}

async function fetchBtcUsd() {
  const now = Date.now();
  if (btcCache.usd != null && now - btcCache.at < 5 * 60 * 1000) {
    return btcCache.usd;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(
      'https://api.coinbase.com/v2/prices/BTC-USD/spot',
      { signal: ctrl.signal },
    );
    clearTimeout(t);
    if (!res.ok) return btcCache.usd;
    const data = await res.json();
    const n = Number(data?.data?.amount);
    if (!Number.isFinite(n) || n <= 0) return btcCache.usd;
    btcCache = { at: now, usd: Math.round(n) };
    return btcCache.usd;
  } catch (_) {
    return btcCache.usd;
  }
}

/**
 * @returns {Promise<string|null>} короткий system-hint или null
 */
async function buildExternalFactHint(systemPrompt, userMessage) {
  const msg = String(userMessage || '');
  if (!msg.trim()) return null;
  const parts = [];

  if (BTC_ASK_RE.test(msg)) {
    const usd = await fetchBtcUsd();
    if (usd) {
      parts.push(
        `Факт (курс): BTC ≈ $${usd.toLocaleString('en-US')} сейчас. ` +
          `Можешь обмолвиться примерно («около ${Math.round(usd / 1000)}к»), без лекции и без вида эксперта.`,
      );
    }
  }

  if (TIME_ASK_RE.test(msg)) {
    const city = extractCityFromPrompt(systemPrompt);
    const clock = formatCityClock(city?.tz || 'Europe/Moscow');
    if (clock) {
      const where = city?.label ? `у тебя в ${city.label}` : 'у тебя';
      parts.push(
        `Факт (время): сейчас ${where} ${clock}. ` +
          `Ответь коротко этим временем (±2 минуты макс), НЕ округляй до получаса вроде «около 19:30», если сейчас ${clock}. ` +
          `Без «по моим данным».`,
      );
    }
  }

  return parts.length ? parts.join(' ') : null;
}

/** Если модель округлила время мимо факта — подставить актуальное. */
function groundClockReply(reply, systemPrompt, userMessage) {
  if (!TIME_ASK_RE.test(String(userMessage || ''))) return reply;
  const city = extractCityFromPrompt(systemPrompt);
  const clock = formatCityClock(city?.tz || 'Europe/Moscow');
  if (!clock) return reply;
  const raw = String(reply || '');
  const tag = (raw.match(/^\s*<<[^>\n]+>>\s*/) || [''])[0];
  const body = raw.slice(tag.length);
  const m = body.match(/(\d{1,2})[:.\s](\d{2})/);
  if (!m) {
    return tag + `сейчас ${clock})`;
  }
  const saidH = Number(m[1]);
  const saidM = Number(m[2]);
  const [realH, realM] = clock.split(':').map(Number);
  if (!Number.isFinite(saidH) || !Number.isFinite(saidM)) return reply;
  // Учёт перехода через полночь (23:55 vs 00:05).
  let drift = Math.abs(saidH * 60 + saidM - (realH * 60 + realM));
  if (drift > 12 * 60) drift = 24 * 60 - drift;
  // >5 мин — выдумка/округление до получаса (19:30 при реальных 19:01).
  if (drift <= 5) return reply;
  const replaced = body.replace(m[0], clock);
  return tag + (/[)….!?]$/.test(replaced.trim()) ? replaced.trim() : `${replaced.trim()})`);
}

module.exports = {
  buildExternalFactHint,
  groundClockReply,
  extractCityFromPrompt,
  fetchBtcUsd,
  BTC_ASK_RE,
  TIME_ASK_RE,
};
