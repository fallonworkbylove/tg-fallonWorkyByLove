const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'services', 'telegramClient.js');
let s = fs.readFileSync(p, 'utf8');

const VOICE_HELPERS = `// Собеседник запретил голосовые в настройках приватности — больше не пробуем.
const voiceForbiddenPeers = new Set();

function isVoiceForbiddenError(err) {
  return /VOICE_MESSAGES_FORBIDDEN/.test(String(err?.errorMessage || err?.message || ''));
}

`;

const VOICE_HELPERS_RE =
  /\n\/\/ Собеседник запретил голосовые в настройках приватности — больше не пробуем\.\nconst voiceForbiddenPeers = new Set\(\);\n\nfunction isVoiceForbiddenError\(err\) \{\n  return \/VOICE_MESSAGES_FORBIDDEN\/\.test\(String\(err\?\.errorMessage \|\| err\?\.message \|\| ''\)\);\n\}\n/;

// 1) require nftCampaign
const scanEnd = "} = require('./scanCatchup');\n";
if (!s.includes("require('./nftCampaign')")) {
  if (!s.includes(scanEnd)) throw new Error('scanCatchup require end missing');
  s = s.replace(
    scanEnd,
    `} = require('./scanCatchup');
const {
  configureNftCampaign,
  VOICES_DIR,
  NFT_VOICE_FILE,
  NFT_VOICE_AFTER_HOURS,
  noteNftVoiceMissing,
  withWorkProblemLine,
  maybeSendWorkAside,
  shouldSuppressNftForTurn,
  sanitizeReplyAgainstNftLeak,
  ensureNftScheduleTable,
  claimWorkMention,
  releaseWorkMention,
  getNftCampaignState,
  tickNftCampaign,
} = require('./nftCampaign');
`,
  );
}

// 2) Pull voiceForbiddenPeers early (before configures), remove from NFT section
s = s.replace(VOICE_HELPERS_RE, '\n');
const voiceKeyFn =
  'function voiceSendKey(accountId, peerId, fileName) {\n  return `${accountId}:${String(peerId)}:${fileName}`;\n}\n';
const vk = s.indexOf(voiceKeyFn);
if (vk < 0) throw new Error('voiceSendKey missing');
if (!s.includes('const voiceForbiddenPeers = new Set();')) {
  s = s.slice(0, vk + voiceKeyFn.length) + '\n' + VOICE_HELPERS + s.slice(vk + voiceKeyFn.length);
}

// 3) configureNftCampaign after configureScanCatchup
if (!s.includes('configureNftCampaign({')) {
  const marker = 'configureScanCatchup({';
  const start = s.indexOf(marker);
  if (start < 0) throw new Error('configureScanCatchup missing');
  let i = s.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        if (s[end] === ')') end++;
        if (s[end] === ';') end++;
        break;
      }
    }
  }
  if (end < 0) throw new Error('configureScanCatchup end');
  const insert = `

configureNftCampaign({
  tgSendMessage: (...args) => tgSendMessage(...args),
  getAccountSettings: (id) => getAccountSettings(id),
  voiceSendInFlight,
  voiceSendKey,
  isVoiceForbiddenError,
  voiceForbiddenPeers,
  isAnswerToHowLong: (h) => isAnswerToHowLong(h),
  bufferKey: (a, p) => bufferKey(a, p),
  getProcessingInFlight: () => processingInFlight,
  getMessageBuffers: () => messageBuffers,
});
`;
  s = s.slice(0, end) + insert + s.slice(end);
}

// 4) Delete NFT campaign block (header → MEDIA header)
const nftHeader = '// ---------------------------------------------------------------------------\n// NFT-КАМПАНИЯ';
const mediaHeader = '// ---------------------------------------------------------------------------\n// МЕДИА (фото/видео/кружки из чата по ссылке)';
const a = s.indexOf(nftHeader);
const b = s.indexOf(mediaHeader);
if (a < 0 || b < 0) throw new Error(`NFT/MEDIA markers ${a} ${b}`);
s = s.slice(0, a) + s.slice(b);

// 5) Delete tickNft* (keep/restored checkWorkBoundary JSDoc)
const tickStart = s.indexOf('async function tickNftWorkMentions(accountId)');
const checkStart = s.indexOf('function checkWorkBoundary(accountId)');
if (tickStart < 0 || checkStart < 0) throw new Error(`tick/check markers ${tickStart} ${checkStart}`);

let cutFrom = tickStart;
const workBoundaryComment = s.lastIndexOf(
  '/**\n * Проверяет переход через границу рабочих часов',
  tickStart,
);
if (workBoundaryComment > 0 && tickStart - workBoundaryComment < 400) {
  cutFrom = workBoundaryComment;
}

const restoredDoc = `/**
 * Проверяет переход через границу рабочих часов и шлёт приветствие.
 * Вызывается по таймеру раз в минуту.
 */
`;
s = s.slice(0, cutFrom) + restoredDoc + s.slice(checkStart);

// 6) Reply-pipeline: use noteNftVoiceMissing()
s = s.replace(
  /if \(!nftVoiceMissingLogged\) \{\s*nftVoiceMissingLogged = true;\s*console\.error\(\s*`\[telegramClient\] Файл \$\{NFT_VOICE_FILE\} не найден в voices\/ — NFT-голосовое отключено\.`,\s*\);\s*\}/g,
  'noteNftVoiceMissing();',
);

fs.writeFileSync(p, s);
console.log('ok lines', s.split(/\n/).length);
console.log('has nftCampaign require', s.includes("require('./nftCampaign')"));
console.log('has configureNftCampaign', s.includes('configureNftCampaign({'));
console.log('has local VOICES_DIR def', /const VOICES_DIR = path\.join/.test(s));
console.log('has tickNftWorkMentions fn', s.includes('async function tickNftWorkMentions'));
console.log('has getNftCampaignState fn', s.includes('async function getNftCampaignState'));
console.log('voiceForbiddenPeers count', (s.match(/const voiceForbiddenPeers/g) || []).length);
console.log('nftVoiceMissingLogged leftover', s.includes('nftVoiceMissingLogged'));
console.log('noteNftVoiceMissing calls', (s.match(/noteNftVoiceMissing\(\)/g) || []).length);
console.log('claimWorkMention still used', (s.match(/claimWorkMention/g) || []).length);
