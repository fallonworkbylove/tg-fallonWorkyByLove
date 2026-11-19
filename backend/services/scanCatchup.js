/**
 * Скан непрочитанных / catch-up после offline.
 * processBufferedMessages + extractIncomingText + Maps — через hooks.
 */
const {
  getActiveClient,
  deactivateAccount,
  isRevokedSessionError,
  accountLabel,
} = require('./clientPool');
const { isWithinWorkingHours, isNightTextQuietHour, getWorkZoneHour } = require('./timing');
const { isPeerBlacklisted, isPeerArchived, isNeverContact } = require('./peers');

const scanInFlight = new Set();
const scanTimers = new Map();
const SCAN_INTERVAL_MS = 5 * 60 * 1000;
const SCAN_MAX_REPLIES = 8;
const SCAN_DIALOGS_LIMIT = 100;

let hooks = {
  getAccountSettings: null,
  bufferKey: null,
  getMessageBuffers: () => new Map(),
  getDeferredDialogs: () => new Map(),
  getProcessingInFlight: () => new Set(),
  extractIncomingText: null,
  processBufferedMessages: null,
};

function configureScanCatchup(next) {
  hooks = { ...hooks, ...next };
}

function startPeriodicScan(accountId) {
  if (scanTimers.has(accountId)) return;
  const timer = setInterval(() => {
    scanUnansweredDialogs(accountId, 90).catch(() => {});
  }, SCAN_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  scanTimers.set(accountId, timer);
}

function stopPeriodicScan(accountId) {
  const timer = scanTimers.get(accountId);
  if (timer) {
    clearInterval(timer);
    scanTimers.delete(accountId);
  }
  scanInFlight.delete(accountId);
}

/**
 * Сканирует НЕархивные личные диалоги и отвечает там, где последнее слово
 * за собеседником (он писал, мы ещё не ответили) — в т.ч. до подключения.
 */
async function scanUnansweredDialogs(accountId, minAgeSec = 90, options = {}) {
  if (scanInFlight.has(accountId)) return;
  scanInFlight.add(accountId);
  const catchUp = Boolean(options.catchUp);
  // Catch-up после простоя/бага: шире лимиты, чтобы добрать весь бэклог.
  const maxReplies = catchUp
    ? Number(options.maxReplies) > 0
      ? Number(options.maxReplies)
      : 120
    : SCAN_MAX_REPLIES;
  const dialogsLimit = catchUp
    ? Number(options.dialogsLimit) > 0
      ? Number(options.dialogsLimit)
      : 400
    : SCAN_DIALOGS_LIMIT;
  try {
    const client = getActiveClient(accountId);
    if (!client) return;

    if (!isWithinWorkingHours(accountId)) return;
    if (isNightTextQuietHour()) return;

    // #95: late catch-up палит — после 22 МСК не догоняем старые диалоги.
    if (catchUp) {
      const hour = getWorkZoneHour();
      if (hour >= 22 || hour < 8) {
        console.log(
          `[${accountLabel(accountId)}] Catch-up skip: поздний/ночной час (${hour}) — без массового догона.`,
        );
        return;
      }
    }

    const settings = await hooks.getAccountSettings(accountId);
    if (!settings || !settings.is_autoreply_enabled) return;

    let dialogs;
    try {
      dialogs = await client.getDialogs({ limit: dialogsLimit });
    } catch (e) {
      console.error(
        `[${accountLabel(accountId)}] Скан: не удалось получить диалоги:`,
        e.errorMessage || e.message,
      );
      if (isRevokedSessionError(e)) {
        console.error(
          `[${accountLabel(accountId)}] Сессия отозвана — останавливаю аккаунт, нужна повторная авторизация.`,
        );
        deactivateAccount(accountId).catch(() => {});
      }
      return;
    }

    dialogs = (dialogs || []).slice().sort((a, b) => {
      const ua = Number(a.unreadCount || 0);
      const ub = Number(b.unreadCount || 0);
      if (ub !== ua) return ub - ua;
      const da = a.message?.date || 0;
      const db_ = b.message?.date || 0;
      return db_ - da;
    });

    if (catchUp) {
      const pending = dialogs.filter(
        (d) => d.isUser && !d.archived && d.message && !d.message.out,
      ).length;
      console.log(
        `[${accountLabel(accountId)}] Catch-up: диалогов где писали нам — ${pending} (лимит ответов ${maxReplies}).`,
      );
    }

    const nowSec = Math.floor(Date.now() / 1000);
    let replied = 0;
    const bufferKey = hooks.bufferKey;
    const messageBuffers = hooks.getMessageBuffers();
    const deferredDialogs = hooks.getDeferredDialogs();
    const processingInFlight = hooks.getProcessingInFlight();

    for (const dialog of dialogs) {
      if (replied >= maxReplies) break;
      if (!dialog.isUser) continue;
      if (dialog.archived) continue;

      const message = dialog.message;
      if (!message) continue;
      if (message.out) continue;
      if (minAgeSec > 0 && message.date && nowSec - message.date < minAgeSec) {
        continue;
      }

      const sender = dialog.entity;
      if (!sender || sender.bot || sender.self || isNeverContact(sender)) continue;

      const peerId = String(sender.id);
      if (await isPeerBlacklisted(accountId, peerId)) continue;
      if (await isPeerArchived(client, sender)) continue;
      try {
        if (await require('./leadScoring').isPeerCleared(accountId, peerId)) continue;
      } catch (_) {
        /* ignore */
      }

      const key = bufferKey(accountId, peerId);
      if (messageBuffers.has(key)) continue;
      if (deferredDialogs.has(key)) continue;
      if (processingInFlight.has(key)) continue;

      let text;
      try {
        text = await hooks.extractIncomingText(accountId, message);
      } catch (_) {
        text = message.message || '';
      }
      if (!text || !text.trim()) continue;

      const senderName = sender.username || sender.firstName || peerId;
      console.log(
        `[${accountLabel(accountId)}] Скан: дочитываю непрочитанный диалог с ${senderName}.`,
      );

      await hooks.processBufferedMessages(
        accountId,
        sender,
        message,
        peerId,
        senderName,
        text.trim(),
      );
      replied += 1;
    }

    if (replied > 0) {
      console.log(
        `[${accountLabel(accountId)}] Скан завершён: отвечено диалогам — ${replied}.`,
      );
    }
  } catch (err) {
    console.error(
      `[${accountLabel(accountId)}] Ошибка скана диалогов:`,
      err.message,
    );
  } finally {
    scanInFlight.delete(accountId);
  }
}

module.exports = {
  configureScanCatchup,
  scanInFlight,
  scanTimers,
  SCAN_INTERVAL_MS,
  scanUnansweredDialogs,
  startPeriodicScan,
  stopPeriodicScan,
};
