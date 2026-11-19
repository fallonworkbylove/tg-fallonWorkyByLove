const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'services', 'telegramClient.js');
let s = fs.readFileSync(p, 'utf8');

const histEnd = "} = require('./history');\n";
if (!s.includes("require('./timing')")) {
  if (!s.includes(histEnd)) throw new Error('history require end missing');
  const timingReq = `} = require('./history');
const {
  configureTiming,
  WORK_START_HOUR,
  WORK_END_HOUR,
  getWorkZoneHour,
  isWithinWorkingHours,
  getAccountTimeStyle,
  isWithinNftCampaignHours,
  isVoiceQuietHour,
  sleep,
  pickReplyDelayMs,
  delayBeforeSendMs,
  plainTextLen,
  computeReadDwellMs,
  computeTypingMs,
  startTypingPulse,
  waitBeforeReply,
  humanPauseBeforeSend,
} = require('./timing');
`;
  s = s.replace(histEnd, timingReq);
}

// Remove WORK_* block through bufferKey (keep bufferKey)
const workStart = s.indexOf(
  '// ---------------------------------------------------------------------------\n// РАБОЧИЕ ЧАСЫ / РЕЖИМ ДНЯ.',
);
const bufferKey = s.indexOf('\nfunction bufferKey(accountId, peerId)');
if (workStart < 0 || bufferKey < 0) throw new Error(`work block ${workStart} ${bufferKey}`);
s = s.slice(0, workStart) + s.slice(bufferKey + 1);

// Remove sleep through humanPauseBeforeSend (before isPeerArchived or next section)
const sleepFn = s.indexOf('/** Пауза на указанное число миллисекунд. */');
const afterHuman = s.indexOf('async function humanPauseBeforeSend');
if (sleepFn < 0 || afterHuman < 0) throw new Error(`sleep block ${sleepFn} ${afterHuman}`);
// Find end of humanPauseBeforeSend
const endHuman = s.indexOf('\n}\n\n', afterHuman);
if (endHuman < 0) throw new Error('end humanPause');
// Check what follows - should be isPeerArchived or similar
s = s.slice(0, sleepFn) + s.slice(endHuman + 1);

// Remove VOICE_QUIET + isVoiceQuietHour local defs
s = s.replace(
  /const VOICE_QUIET_START_HOUR = 1;\nconst VOICE_QUIET_END_HOUR = 8;\n[\s\S]*?function isVoiceQuietHour\(\) \{\n  const hour = getWorkZoneHour\(\);\n  return hour >= VOICE_QUIET_START_HOUR \|\| hour < VOICE_QUIET_END_HOUR;\n\}\n\n/,
  '',
);

// Wire configureTiming near configureClientPool
const cfgMarker = 'configureClientPool({\n  onActivated: onClientActivated,\n  clearAccountRuntime,\n  normalizePhone: normalizeLoginPhone,\n});\n';
if (!s.includes('configureTiming({')) {
  if (!s.includes(cfgMarker)) throw new Error('configureClientPool marker missing');
  s = s.replace(
    cfgMarker,
    `${cfgMarker}
configureTiming({
  getDailyLife: (accountId) => ensureDailyLife(accountId),
  moscowClock: (...args) => moscowClock(...args),
  markPeerAsRead: (...args) => markPeerAsRead(...args),
});
`,
  );
}

fs.writeFileSync(p, s);
console.log('ok lines', s.split(/\n/).length);
