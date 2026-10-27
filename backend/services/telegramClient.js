require('./relaxGramJsPing');
const {
  ConnectionTCPFull443,
  PROXY_POOL,
  LOGIN_PROXY_POOL,
  proxyLabel,
  connectionCandidates,
  loginConnectionCandidates,
} = require('./proxyPools');
const {
  configureClientPool,
  activateAccount,
  deactivateAccount,
  forgetRevokedAccount,
  pingActiveSession,
  getActiveClient,
  isActive,
  accountKey,
  accountLabel,
  accountDisplayName,
  findActiveAccountIdByUsername,
  getAccountUsername,
  isRevokedSessionError,
} = require('./clientPool');
const {
  conversationIsRussian,
  saveMessage,
  getDialogTail,
  lastIncomingAgeMin,
  hasUnansweredProactive,
  getDialogAgeHours,
} = require('./history');
const {
  configureTiming,
  getWorkZoneHour,
  isWithinWorkingHours,
  isVoiceQuietHour,
  computeReadDwellMs,
  computeTypingMs,
} = require('./timing');
const {
  configurePeers,
  isPeerArchived,
  isPermanentSendError,
  retireUnreachablePeer,
  shouldSkipProactivePeer,
  isNeverContact,
  isDeletedUser,
  loadArchiveFlags,
  isFloodError,
  isHiddenFromReplies,
  markPeerAsRead,
  archivePeer,
  unarchivePeer,
} = require('./peers');
const {
  configureScanCatchup,
  scanUnansweredDialogs,
  startPeriodicScan,
  stopPeriodicScan,
} = require('./scanCatchup');
const {
  configureNftCampaign,
  NFT_VOICE_AFTER_HOURS,
  ensureNftScheduleTable,
  claimWorkMention,
  tickNftCampaign,
} = require('./nftCampaign');

const {
  configureInbound,
  clearInboundAccountRuntime,
  flushAllDeferredNow,
  messageBuffers,
  processingInFlight,
  deferredDialogs,
  voiceSendInFlight,
  bufferKey,
  voiceSendKey,
  extractIncomingText,
  handleIncomingMessage,
} = require('./inbound');

const {
  configureReplyPipeline,
  voiceForbiddenPeers,
  isVoiceForbiddenError,
  extractMediaRequest,
  resolveMediaPromise,
  sanitizeOutgoingText,
  stripLeakedMediaHistoryTag,
  tgSendMessage,
  parseStayDays,
  isAnswerToHowLong,
  processBufferedMessages,
  fireReengage,
} = require('./replyPipeline');

const {
  configureDailyLife,
  ensureDailyLife,
  tickDailyLife,
  moscowClock,
  formatClock,
  dialogAlreadySaidGoodbye,
  clearDailyLifeAccount,
} = require('./dailyLife');

const { NewMessage } = require('telegram/events');
const db = require('../db');
const timeStyle = require('./timeStyle');

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

// Прокси: proxyPools.js. Пул клиентов: clientPool.js.

// Pending-логины живут в loginAuth.js (QR + phone).


// ---------------------------------------------------------------------------
// ВХОД — вынесен в loginAuth.js (QR основной + телефон/код в app).
// ---------------------------------------------------------------------------
const loginAuth = require('./loginAuth');

loginAuth.configureLoginAuth({
  apiId,
  apiHash,
  loginConnectionCandidates,
  workConnectionCandidates: connectionCandidates,
  loginPool: LOGIN_PROXY_POOL.length ? LOGIN_PROXY_POOL : PROXY_POOL,
  workPool: PROXY_POOL,
  loginPoolKind: LOGIN_PROXY_POOL.length ? 'residential' : 'work/DC-fallback',
  proxyLabel,
  ConnectionTCPFull443,
});

const {
  normalizeLoginPhone,
  extractLoginCode,
  startLogin,
  startQrLogin,
  pollQrLogin,
  resendLoginCode,
  confirmCode,
  confirmPassword,
  cancelPendingLogin,
  cancelAllPendingLoginsForUser,
  peekPendingLogin,
  qrImageUrl,
  QR_MARKER,
} = loginAuth;

// ---------------------------------------------------------------------------
// ПУЛ АКТИВНЫХ КЛИЕНТОВ — clientPool.js (lifecycle + labels)
// Здесь только hooks: inbound handler, scan/boundary timers, runtime cleanup.
// ---------------------------------------------------------------------------

function onClientActivated(accountId, client) {
  client.addEventHandler(
    (event) => handleIncomingMessage(accountId, event),
    new NewMessage({ incoming: true }),
  );

  // Фоном дочитываем чаты, где собеседник писал до/пока мы были offline.
  scanUnansweredDialogs(accountId, 0, { catchUp: true }).catch((e) =>
    console.error(
      `[${accountLabel(accountId)}] Скан при активации не удался:`,
      e.message,
    ),
  );

  startPeriodicScan(accountId);

  if (!boundaryTimers.has(accountId)) {
    workStateByAccount.set(accountId, timeStyle.getTimeStyle(getWorkZoneHour()).id);
    const bTimer = setInterval(
      () => checkWorkBoundary(accountId),
      BOUNDARY_CHECK_MS,
    );
    if (typeof bTimer.unref === 'function') bTimer.unref();
    boundaryTimers.set(accountId, bTimer);
  }
}

function clearAccountRuntime(accountId) {
  stopPeriodicScan(accountId);

  const bTimer = boundaryTimers.get(accountId);
  if (bTimer) {
    clearInterval(bTimer);
    boundaryTimers.delete(accountId);
  }
  workStateByAccount.delete(accountId);
  clearDailyLifeAccount(accountId);

  clearInboundAccountRuntime(accountId);
}

configureClientPool({
  onActivated: onClientActivated,
  clearAccountRuntime,
  normalizePhone: normalizeLoginPhone,
});

configureTiming({
  getDailyLife: (accountId) => ensureDailyLife(accountId),
  moscowClock: (...args) => moscowClock(...args),
  markPeerAsRead: (...args) => markPeerAsRead(...args),
});

configurePeers({
  onPeerRetired: async (accountId, peerId) => {
    try { await claimWorkMention(accountId, peerId); } catch (_) {}
    try {
      await ensureNftScheduleTable();
      await db.execute(
        `INSERT INTO nft_voice_schedule
           (account_id, peer_id, scheduled_at, work_mention_at, work_mention_sent)
         VALUES (?, ?, NOW(), NOW(), 1)
         ON DUPLICATE KEY UPDATE work_mention_sent = 1`,
        [accountId, String(peerId)],
      );
    } catch (_) {}
  },
});

configureScanCatchup({
  getAccountSettings: (id) => getAccountSettings(id),
  bufferKey: (a, p) => bufferKey(a, p),
  getMessageBuffers: () => messageBuffers,
  getDeferredDialogs: () => deferredDialogs,
  getProcessingInFlight: () => processingInFlight,
  extractIncomingText: (...args) => extractIncomingText(...args),
  processBufferedMessages: (...args) => processBufferedMessages(...args),
});

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

configureInbound({
  processBufferedMessages: (...args) => processBufferedMessages(...args),
  fireReengage: (...args) => fireReengage(...args),
  getAccountSettings: (id) => getAccountSettings(id),
  tgSendMessage: (...args) => tgSendMessage(...args),
});





// ---------------------------------------------------------------------------
// ОБРАБОТКА ВХОДЯЩИХ СООБЩЕНИЙ
// ---------------------------------------------------------------------------

/**
 * Возвращает данные аккаунта (промпт, флаг автоответчика и диапазон
 * задержки перед ответом) из БД.
 */
async function getAccountSettings(accountId) {
  const [rows] = await db.execute(
  `SELECT phone, prompt, is_autoreply_enabled, reply_delay_min, reply_delay_max, media_chat_link
  FROM accounts WHERE id = ? LIMIT 1`,
  [accountId],
  );
  return rows[0] || null;
}

configureReplyPipeline({
  getAccountSettings: (id) => getAccountSettings(id),
  ensureDailyLife: (id) => ensureDailyLife(id),
  formatClock: (...args) => formatClock(...args),
});

configureDailyLife({
  getAccountSettings: (id) => getAccountSettings(id),
  tgSendMessage: (...args) => tgSendMessage(...args),
  bufferKey: (a, p) => bufferKey(a, p),
  getMessageBuffers: () => messageBuffers,
  getDeferredDialogs: () => deferredDialogs,
  getProcessingInFlight: () => processingInFlight,
  extractIncomingText: (...args) => extractIncomingText(...args),
  processBufferedMessages: (...args) => processBufferedMessages(...args),
});

// Последнее состояние «рабочее время?» по аккаунту — для детекта перехода.
const workStateByAccount = new Map();
// Таймеры проверки границы рабочих часов.
const boundaryTimers = new Map();
// Как часто проверять границу (раз в минуту — приветствие в пределах минуты).
const BOUNDARY_CHECK_MS = 60 * 1000;

/**
 * Проверяет переход через границу рабочих часов и шлёт приветствие.
 * Вызывается по таймеру раз в минуту.
 */
function checkWorkBoundary(accountId) {
    tickNftCampaign(accountId).catch((err) => {
      console.error(
        `[${accountLabel(accountId)}] Фраза про работу перед голосовым:`,
        err.message,
      );
    });
    const currentPeriodId = timeStyle.getTimeStyle(getWorkZoneHour()).id;
    const previousPeriodId = workStateByAccount.get(accountId);
    if (previousPeriodId === undefined) {
      workStateByAccount.set(accountId, currentPeriodId);
      ensureDailyLife(accountId);
      return;
    }
    workStateByAccount.set(accountId, currentPeriodId);
    tickDailyLife(accountId);
}

module.exports = {
  extractMediaRequest,
  resolveMediaPromise,
  sanitizeOutgoingText,
  stripLeakedMediaHistoryTag,
  startLogin,
  startQrLogin,
  pollQrLogin,
  resendLoginCode,
  confirmCode,
  confirmPassword,
  cancelPendingLogin,
  cancelAllPendingLoginsForUser,
  peekPendingLogin,
  extractLoginCode,
  normalizeLoginPhone,
  qrImageUrl,
  QR_MARKER,
  activateAccount,
  deactivateAccount,
  forgetRevokedAccount,
  pingActiveSession,
  getActiveClient,
  isActive,
  accountLabel,
  accountDisplayName,
  getAccountUsername,
  findActiveAccountIdByUsername,
  scanUnansweredDialogs,
  flushAllDeferredNow,
  getAccountSettings,
  isWithinWorkingHours,
  isVoiceQuietHour,
  isPeerArchived,
  isNeverContact,
  shouldSkipProactivePeer,
  hasUnansweredProactive,
  lastIncomingAgeMin,
  isDeletedUser,
  isPermanentSendError,
  retireUnreachablePeer,
  saveMessage,
  archivePeer,
  unarchivePeer,
  parseStayDays,
  isHiddenFromReplies,
  loadArchiveFlags,
  isFloodError,
  dialogAlreadySaidGoodbye,
  NFT_VOICE_AFTER_HOURS,
  getDialogAgeHours,
  conversationIsRussian,
  computeTypingMs,
  computeReadDwellMs,
};
