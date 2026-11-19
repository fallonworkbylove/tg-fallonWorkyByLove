const fs = require('fs');
const p = require('path').join(__dirname, '..', 'services', 'telegramClient.js');
let s = fs.readFileSync(p, 'utf8');

const marker = "} = require('./clientPool');\n";
if (!s.includes("require('./history')")) {
  const histReq = `} = require('./clientPool');
const {
  HISTORY_LIMIT,
  SESSION_GAP_HOURS,
  ACTIVE_DIALOGUE_IDLE_HOURS,
  PROACTIVE_GAP_MS,
  getHistory,
  filterHistoryToCurrentSession,
  isFreshSessionAfterGap,
  buildEmotionHint,
  buildSessionForgetHint,
  conversationIsRussian,
  conversationReplyLang,
  saveMessage,
  voiceTag,
  wasVoiceSent,
  wasAnyVoiceSent,
  lastAnyVoiceSentAt,
  lastIncomingText,
  getDialogTail,
  lastIncomingAgeMin,
  hasUnansweredProactive,
  getDialogAgeHours,
} = require('./history');
`;
  if (!s.includes(marker)) throw new Error('clientPool marker missing');
  s = s.replace(marker, histReq);
}

s = s.replace(
  /\/\/ Сколько последних сообщений диалога[\s\S]*?const HISTORY_LIMIT = 60;\n\n/,
  '',
);

const start = s.indexOf('/**\n * Достаёт последние сообщения диалога');
const nft = s.indexOf('// ---------------------------------------------------------------------------\n// NFT-КАМПАНИЯ');
if (start < 0 || nft < 0) throw new Error(`history block markers: ${start} ${nft}`);
s = s.slice(0, start) + s.slice(nft);

// Preserve NFT_LIVE_* constants; remove getDialogTail / lastIncoming* / getDialogAgeHours.
const liveKeep = `// NFT-шаги сами по себе шлём только в живой диалог: он писал совсем недавно.
const NFT_LIVE_DIALOG_MIN = 30;
const NFT_VOICE_LIVE_DIALOG_MIN = 60;

`;
const gt2 = s.indexOf('async function getDialogTail');
if (gt2 < 0) throw new Error('getDialogTail missing');
const gtComment = s.lastIndexOf('/**', gt2);
const afterAge = s.indexOf('async function getDialogAgeHours');
const endAge = s.indexOf('\n}\n\n/**\n * Упоминала ли бот NFT', afterAge);
if (gtComment < 0 || endAge < 0) throw new Error(`cut2 ${gtComment} ${endAge}`);
s = s.slice(0, gtComment) + liveKeep + s.slice(endAge + 1);

s = s.replace(
  /const NFT_DIALOG_SESSION_GAP_HOURS = 72;\nconst NFT_ACTIVE_DIALOGUE_IDLE_HOURS = 72;/,
  'const NFT_DIALOG_SESSION_GAP_HOURS = SESSION_GAP_HOURS;\nconst NFT_ACTIVE_DIALOGUE_IDLE_HOURS = ACTIVE_DIALOGUE_IDLE_HOURS;',
);

fs.writeFileSync(p, s);
console.log('ok lines', s.split(/\n/).length);
