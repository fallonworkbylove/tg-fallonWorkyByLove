/**
 * Рабочие часы, задержки, typing / read-dwell.
 * Режим дня (ensureDailyLife) и markPeerAsRead — через hooks.
 */
const { Api } = require('telegram');
const timeStyle = require('./timeStyle');
const humanExtra = require('./humanExtra');

const WORK_START_HOUR = Number.parseInt(process.env.WORK_START_HOUR, 10) || 9;
const WORK_END_HOUR = Number.parseInt(process.env.WORK_END_HOUR, 10) || 23;
const WORK_TIMEZONE = process.env.WORK_TIMEZONE || 'Europe/Moscow';

const VOICE_QUIET_START_HOUR = 1;
const VOICE_QUIET_END_HOUR = 8;

let hooks = {
  getDailyLife: null,
  moscowClock: null,
  markPeerAsRead: null,
};

function configureTiming(next) {
  hooks = { ...hooks, ...next };
}

function getWorkZoneHour() {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: WORK_TIMEZONE,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const hourPart = parts.find((p) => p.type === 'hour');
    if (hourPart) return Number.parseInt(hourPart.value, 10) % 24;
  } catch (_) {
    /* fallback UTC+3 */
  }
  return (new Date().getUTCHours() + 3) % 24;
}

function isWithinGlobalWorkingHours() {
  const hour = getWorkZoneHour();
  if (WORK_START_HOUR <= WORK_END_HOUR) {
    return hour >= WORK_START_HOUR && hour < WORK_END_HOUR;
  }
  return hour >= WORK_START_HOUR || hour < WORK_END_HOUR;
}

/**
 * Бодрствует ли аккаунт сейчас.
 * С accountId — по её подъёму/сну; без него — глобальные 09–23.
 */
function isWithinWorkingHours(accountId) {
  if (accountId == null || accountId === '') {
    return isWithinGlobalWorkingHours();
  }

  try {
    if (typeof hooks.getDailyLife !== 'function' || typeof hooks.moscowClock !== 'function') {
      return isWithinGlobalWorkingHours();
    }
    const life = hooks.getDailyLife(accountId);
    const { minutes } = hooks.moscowClock();
    const wake = Number(life.wakeMin) || WORK_START_HOUR * 60;
    const sleep = Number(life.sleepMin) || WORK_END_HOUR * 60;

    if (sleep < 24 * 60) {
      return minutes >= wake && minutes < sleep;
    }

    const sleepToday = sleep - 24 * 60;
    if (minutes >= wake) return true;
    if (minutes < sleepToday) return true;
    return false;
  } catch (_) {
    return isWithinGlobalWorkingHours();
  }
}

/**
 * Стиль времени для промпта с учётом режима дня аккаунта.
 */
function getAccountTimeStyle(accountId) {
  const info = timeStyle.getTimeStyle(undefined, accountId);
  const awake = isWithinWorkingHours(accountId);
  if (!awake) {
    return { ...info, isSleep: true, isNight: true };
  }
  if (info.isSleep) {
    let lateFlavor = '';
    try {
      const { getOnlineFlavor } = require('./lifeTexture');
      lateFlavor = ` ${getOnlineFlavor(accountId, 'late_evening')}`;
    } catch (_) {
      /* optional */
    }
    return {
      ...info,
      id: 'late_evening',
      isSleep: false,
      isNight: true,
      delayMultiplier: Math.max(Number(info.delayMultiplier) || 1, 1.4),
      hint:
        `${String(info.hint || '').replace(/\s*Ты спишь\.[^.]*/i, '')} ` +
        'Уже поздно, скоро спать — отвечай короче и спокойнее, можно сказать что скоро отключишься. ' +
        `Не пиши, что уже спишь.${lateFlavor}`,
    };
  }
  return info;
}

function isWithinNftCampaignHours() {
  const hour = getWorkZoneHour();
  return hour >= 16 && hour < 21;
}

/** Глубокая ночь 01:00–08:00 МСК — без голосовых пингов/заготовок. */
function isVoiceQuietHour() {
  const hour = getWorkZoneHour();
  // Было `||` — из‑за START=1 тихие часы были ВСЕГДА (17 >= 1). Нужен AND.
  return hour >= VOICE_QUIET_START_HOUR && hour < VOICE_QUIET_END_HOUR;
}

/**
 * Тот же слот 01–08 МСК: не шлём и обычный текст (как спит).
 * Сообщение остаётся непрочитанным → утренний скан / silence-heal.
 */
function isNightTextQuietHour() {
  return isVoiceQuietHour();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickReplyDelayMs(settings) {
  const clamp = (n, def) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return def;
    return Math.min(60, Math.max(0, Math.round(v)));
  };

  let min = clamp(settings && settings.reply_delay_min, 2);
  let max = clamp(settings && settings.reply_delay_max, 5);
  if (min > max) [min, max] = [max, min];
  if (min === max) return Math.round(min * 1000);

  const seconds = min + Math.random() * (max - min);
  return Math.round(seconds * 1000);
}

function delayBeforeSendMs(settings, text, opts = {}) {
  const think = pickReplyDelayMs(settings);
  const typing = computeTypingMs(text, opts.accountId);
  let base;
  if (opts.alreadyTyping) {
    base = think + Math.min(1800, Math.max(300, Math.round(typing * 0.35)));
  } else {
    base = think + typing;
  }
  // 0gj: delay ≠ длина — пересчитать think/typing через humanRhythm
  try {
    const { reshapeDelayPair } = require('./humanRhythm');
    const shaped = reshapeDelayPair({
      baseDelayMs: base,
      outText: text,
      incomingText: opts.incomingText || '',
      accountId: opts.accountId,
    });
    return shaped.delayMs;
  } catch (_) {
    return base;
  }
}

function plainTextLen(text) {
  return String(text || '')
    .replace(/<<[^>]+>>/g, '')
    .replace(/\s+/g, ' ')
    .trim().length;
}

function computeReadDwellMs(incomingText) {
  const len = plainTextLen(incomingText);
  const openChat = 450 + Math.random() * 900;
  if (!len) return Math.round(openChat + 200 + Math.random() * 500);
  const charsPerSec = 22 + Math.random() * 14;
  const readMs = Math.min(5500, (len / charsPerSec) * 1000);
  const thinkBit = Math.random() < 0.4 ? 350 + Math.random() * 1100 : 0;
  return Math.min(7500, Math.round(openChat + readMs * 0.55 + thinkBit));
}

function computeTypingMs(text, accountId = null) {
  const len = plainTextLen(text);
  const pace = accountId != null ? humanExtra.getAccountPace(accountId) : null;
  const mul = pace?.typingMul || 1;
  let base;
  if (!len) base = 350 + Math.random() * 450;
  else if (len <= 6) base = 420 + Math.random() * 480;
  else if (len <= 18) base = 650 + Math.random() * 700 + len * 35;
  else {
    const charsPerSec = 7.2 + Math.random() * 5.8;
    let typeMs = (len / charsPerSec) * 1000;
    const hesitations = Math.floor(len / (50 + Math.floor(Math.random() * 20)));
    for (let i = 0; i < hesitations; i += 1) {
      if (Math.random() < 0.6) typeMs += 280 + Math.random() * 780;
    }
    base = typeMs;
  }
  return Math.min(9000, Math.max(600, Math.round(base * mul)));
}

function startTypingPulse(client, peer) {
  let stopped = false;
  let timer = null;
  const tick = async () => {
    if (stopped) return;
    try {
      await client.invoke(
        new Api.messages.SetTyping({
          peer,
          action: new Api.SendMessageTypingAction(),
        }),
      );
    } catch (_) {
      /* индикатор не критичен */
    }
    if (!stopped) timer = setTimeout(tick, 3800);
  };
  tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

async function waitBeforeReply(client, peer, delayMs, typingMs = 4000) {
  const typeBudget = Math.max(0, Math.min(Number(typingMs) || 0, Math.max(0, delayMs)));
  const silentMs = Math.max(0, delayMs - typeBudget);
  if (silentMs > 0) await sleep(silentMs);

  let typingElapsed = 0;
  while (typingElapsed < typeBudget) {
    try {
      await client.invoke(
        new Api.messages.SetTyping({
          peer,
          action: new Api.SendMessageTypingAction(),
        }),
      );
    } catch (_) {
      /* */
    }

    const rethinkChance = waitBeforeReply._rethinkChance ?? 0.22;
    if (
      typeBudget - typingElapsed > 1800 &&
      typingElapsed > 900 &&
      Math.random() < rethinkChance
    ) {
      try {
        await client.invoke(
          new Api.messages.SetTyping({
            peer,
            action: new Api.SendMessageCancelAction(),
          }),
        );
      } catch (_) {}
      const pause = 400 + Math.random() * 1100;
      await sleep(pause);
      typingElapsed += pause;
      continue;
    }

    const refresh = 3000 + Math.floor(Math.random() * 1500);
    const chunk = Math.min(refresh, typeBudget - typingElapsed);
    await sleep(chunk);
    typingElapsed += chunk;
  }
}

async function humanPauseBeforeSend(
  client,
  peer,
  message,
  delayMs,
  typingMs,
  incomingText = '',
  accountId = null,
) {
  if (typeof hooks.markPeerAsRead === 'function') {
    await hooks.markPeerAsRead(client, peer, message);
  }

  const incoming =
    incomingText ||
    message?.message ||
    message?.text ||
    (typeof message === 'string' ? message : '') ||
    '';
  const readDwellMs = computeReadDwellMs(incoming);
  const typeMs = Math.min(
    typingMs != null ? typingMs : computeTypingMs('', accountId),
    Math.max(0, delayMs),
  );
  const silentBudget = Math.max(0, delayMs - typeMs);
  const dwell = Math.min(readDwellMs, Math.max(380, silentBudget + 600));
  await sleep(dwell);
  const remainingSilent = Math.max(0, silentBudget - dwell);
  if (accountId != null) {
    waitBeforeReply._rethinkChance = humanExtra.getAccountPace(accountId).rethinkChance;
  }
  await waitBeforeReply(client, peer, remainingSilent + typeMs, typeMs);
  waitBeforeReply._rethinkChance = undefined;
}

module.exports = {
  configureTiming,
  WORK_START_HOUR,
  WORK_END_HOUR,
  WORK_TIMEZONE,
  VOICE_QUIET_START_HOUR,
  VOICE_QUIET_END_HOUR,
  getWorkZoneHour,
  isWithinGlobalWorkingHours,
  isWithinWorkingHours,
  getAccountTimeStyle,
  isWithinNftCampaignHours,
  isVoiceQuietHour,
  isNightTextQuietHour,
  sleep,
  pickReplyDelayMs,
  delayBeforeSendMs,
  plainTextLen,
  computeReadDwellMs,
  computeTypingMs,
  startTypingPulse,
  waitBeforeReply,
  humanPauseBeforeSend,
};
