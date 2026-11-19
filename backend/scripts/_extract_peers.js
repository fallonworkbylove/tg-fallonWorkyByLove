const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'services', 'telegramClient.js');
let s = fs.readFileSync(p, 'utf8');

const timingEnd = "} = require('./timing');\n";
if (!s.includes("require('./peers')")) {
  if (!s.includes(timingEnd)) throw new Error('timing require end missing');
  const peersReq = `} = require('./timing');
const {
  configurePeers,
  isPeerBlacklisted,
  isPeerArchived,
  isPermanentSendError,
  retireUnreachablePeer,
  shouldSkipProactivePeer,
  isNeverContact,
  isDeletedUser,
  isServiceMessage,
  isTriggerMessageAlive,
  cancelReplyIfDialogGone,
  listUserDialogs,
  loadArchiveFlags,
  markArchivedInCache,
  isFloodError,
  isHiddenFromReplies,
  markPeerAsRead,
  peerHasIncoming,
  persistArchiveState,
  archivePeer,
  unarchivePeer,
  mutePeerForever,
  rearchiveOurOnlyWorkChats,
} = require('./peers');
`;
  s = s.replace(timingEnd, peersReq);
}

function cutBetween(src, startNeedle, endNeedle, keepEnd = true) {
  const a = src.indexOf(startNeedle);
  if (a < 0) throw new Error('start missing: ' + startNeedle.slice(0, 60));
  const b = src.indexOf(endNeedle, a + 1);
  if (b < 0) throw new Error('end missing after: ' + startNeedle.slice(0, 40));
  return src.slice(0, a) + (keepEnd ? src.slice(b) : src.slice(b + endNeedle.length));
}

// Remove isPeerBlacklisted through cancelReplyIfDialogGone (before NFT section).
// Restore inbound text helpers that lived between isServiceMessage and isTrigger*.
const inboundHelpers = `/** Текст спойлера / media.spoiler — GramJS отдаёт plaintext в message.message. */
function messageHasSpoiler(message) {
  if (!message) return false;
  const media = message.media;
  if (media && (media.spoiler === true || media.spoiler === 1)) return true;
  const list = Array.isArray(message.entities) ? message.entities : [];
  return list.some(
    (e) => e && /Spoiler/i.test(String(e.className || '')),
  );
}

function extractPlainIncomingText(message) {
  if (!message) return '';
  if (message.message != null && String(message.message).length) return String(message.message);
  if (message.text != null && String(message.text).length) return String(message.text);
  return '';
}

`;
{
  const startNeedle = 'async function isPeerBlacklisted(accountId, peerId) {';
  const endNeedle = '// ---------------------------------------------------------------------------\n// NFT-КАМПАНИЯ';
  const a = s.indexOf(startNeedle);
  const b = s.indexOf(endNeedle, a + 1);
  if (a < 0 || b < 0) throw new Error('peers block cut failed');
  s = s.slice(0, a) + inboundHelpers + s.slice(b);
}

// Remove listUserDialogs through peerHasIncoming (before addNftScheduleColumn)
s = cutBetween(
  s,
  'async function listUserDialogs(client, maxCount = 5000) {',
  'async function addNftScheduleColumn(name, definition) {',
);

// Remove voiceForbidden if it was between markArchived and isFlood - check
// Actually voiceForbidden was between markArchivedInCache and isFloodError - it got removed
// with the cut of listUserDialogs..peerHasIncoming. Need to restore voiceForbiddenPeers.
if (!s.includes('const voiceForbiddenPeers')) {
  const addNft = s.indexOf('async function addNftScheduleColumn');
  if (addNft < 0) throw new Error('addNftScheduleColumn missing');
  s =
    s.slice(0, addNft) +
    `// Собеседник запретил голосовые в настройках приватности — больше не пробуем.
const voiceForbiddenPeers = new Set();

function isVoiceForbiddenError(err) {
  return /VOICE_MESSAGES_FORBIDDEN/.test(String(err?.errorMessage || err?.message || ''));
}

` +
    s.slice(addNft);
}

// Remove persistArchiveState through mutePeerForever (before shouldAskHowLong)
s = cutBetween(
  s,
  'function persistArchiveState(client, peer, archived) {',
  'async function shouldAskHowLong(accountId, peerId) {',
);

// Remove rearchive block through end of rearchiveOurOnlyWorkChats (before tickNftCampaign)
s = cutBetween(
  s,
  'const OUR_ONLY_WORK_RE = /проблем',
  'async function tickNftCampaign(accountId) {',
);

// Wire configurePeers after configureTiming
if (!s.includes('configurePeers({')) {
  const timingCfg = s.indexOf('configureTiming({');
  if (timingCfg < 0) throw new Error('configureTiming missing');
  const endCfg = s.indexOf('});', timingCfg);
  if (endCfg < 0) throw new Error('configureTiming end');
  const insertAt = endCfg + 3;
  const peersCfg = `

configurePeers({
  onPeerRetired: async (accountId, peerId) => {
    try { await claimWorkMention(accountId, peerId); } catch (_) {}
    try {
      await ensureNftScheduleTable();
      await db.execute(
        \`INSERT INTO nft_voice_schedule
           (account_id, peer_id, scheduled_at, work_mention_at, work_mention_sent)
         VALUES (?, ?, NOW(), NOW(), 1)
         ON DUPLICATE KEY UPDATE work_mention_sent = 1\`,
        [accountId, String(peerId)],
      );
    } catch (_) {}
  },
});
`;
  s = s.slice(0, insertAt) + peersCfg + s.slice(insertAt);
}

fs.writeFileSync(p, s);
console.log('ok lines', s.split(/\n/).length);
