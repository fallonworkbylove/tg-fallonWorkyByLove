/**
 * Reply pipeline: processBufferedMessages, fireReengage, sanitize/send helpers,
 * reaction/laugh. Media → mediaSend.js, how-long → howLong.js.
 * getAccountSettings / daily-life clock — через configureReplyPipeline.
 */
const path = require('path');
const fs = require('fs');
const { Api } = require('telegram');

const {
  getActiveClient,
  accountLabel,
} = require('./clientPool');
const {
  getHistory,
  buildEmotionHint,
  buildSessionForgetHint,
  saveMessage,
  wasVoiceSent,
  lastAnyVoiceSentAt,
  lastIncomingText,
  getDialogAgeHours,
  voiceTag,
} = require('./history');
const {
  isWithinWorkingHours,
  getAccountTimeStyle,
  isVoiceQuietHour,
  isNightTextQuietHour,
  sleep,
  pickReplyDelayMs,
  delayBeforeSendMs,
  computeTypingMs,
  waitBeforeReply,
  humanPauseBeforeSend,
} = require('./timing');
const {
  isPeerBlacklisted,
  isPeerArchived,
  isPermanentSendError,
  retireUnreachablePeer,
  isNeverContact,
  cancelReplyIfDialogGone,
  markPeerAsRead,
  archivePeer,
} = require('./peers');
const {
  VOICES_DIR,
  NFT_VOICE_FILE,
  noteNftVoiceMissing,
  maybeSendWorkAside,
  shouldSuppressNftForTurn,
  sanitizeReplyAgainstNftLeak,
  claimWorkMention,
  releaseWorkMention,
  getNftCampaignState,
} = require('./nftCampaign');
const {
  messageBuffers,
  processingInFlight,
  lastReplyAt,
  lastAnsweredMsgId,
  pendingAfterInFlight,
  gapRetries,
  deferredDialogs,
  reengageInFlight,
  voiceSendInFlight,
  MIN_REPLY_GAP_MS,
  DEFER_CHANCE,
  DEFER_MIN_HISTORY,
  DEFER_INTERRUPT_DELAY_MS,
  bufferKey,
  voiceSendKey,
  stripQuoteMarkers,
  scheduleAfterthought,
  scheduleLaterTextReturn,
  scheduleReengage,
  scheduleGapRetry,
} = require('./inbound');

const {
  generateReply,
  isRussianConversation,
  extractUserQuestions,
  heJustGreeted,
} = require('./aiResponder');
const { looksLikeFarewell } = require('./dailyLife');
const learningDb = require('./learningDb');
const ragExamples = require('./ragExamples');
const {
  findVoiceForText,
  findTextReplyForText,
  sendVoiceReply,
} = require('./voiceReplies');
const { prepareOutboundText } = require('./replySendPrep');
const {
  configureMediaSend,
  voiceForbiddenPeers,
  isVoiceForbiddenError,
  isTypoFixMessage,
  isHardMediaRequest,
  isExplicitMediaRequest,
  isMediaPromiseText,
  isMediaRefusalText,
  pickMediaSendAck,
  unfulfilledMediaPromiseCount,
  resolveMediaPromise,
  detectRequestedMediaType,
  BARE_MEDIA_FILLER_RE,
  lastAssistantWasMedia,
  peerComplainedMediaNotFresh,
  botRecentlyRefusedVideo,
  peerAsksToProveHuman,
  stripLeakedMediaHistoryTag,
  extractMediaRequest,
  mediaRefusalQuietNow,
  canSendContextualCircle,
  buildMediaContextText,
  isTopicPhotoRequest,
  trySendMedia,
  maybeNotifyMediaMissed,
  sendRequestedMediaOrDeflect,
} = require('./mediaSend');

/** Если файл уходит в этом ходе — отказный текст → короткий ack. */
function ensureMediaAckText(outText, mediaType) {
  if (!mediaType) return outText;
  if (!outText || isMediaRefusalText(outText) || isMediaPromiseText(outText)) {
    return pickMediaSendAck();
  }
  return outText;
}
const {
  howLongInFlight,
  HOWLONG_ARCHIVE_DAYS,
  buildHowLongQuestion,
  isAnswerToHowLong,
  parseStayDays,
  shouldAskHowLong,
} = require('./howLong');
const helpRequestNotifier = require('./helpRequestNotifier');

/** После humanPause — оператор мог нажать pause / пир в ЧС. Fail-closed. */
async function abortIfPausedOrBlacklisted(accountId, peerId, senderName, where) {
  if (await helpRequestNotifier.isAutoreplyDisabledForPeer(accountId, peerId)) {
    console.log(
      `[${accountLabel(accountId)}] ${senderName}: пауза/handoff ${where} — не отправляю.`,
    );
    return true;
  }
  if (await isPeerBlacklisted(accountId, peerId)) {
    console.log(
      `[${accountLabel(accountId)}] ${senderName}: blacklist ${where} — не отправляю.`,
    );
    return true;
  }
  return false;
}
const moodEngine = require('./moodEngine');
const memoryTriggers = require('./memoryTriggers');
const accountPersona = require('./accountPersona');
const objectionHandler = require('./objectionHandler');
const complimentEngine = require('./complimentEngine');
const humanExtra = require('./humanExtra');
const peerProfile = require('./peerProfile');
const leadScoring = require('./leadScoring');
const externalFacts = require('./externalFacts');
const humanHardening = require('./humanHardening');

/** Не слать голосовую заготовку чаще раза в 3ч на диалог (антидубль одинаковых ГС). */
const VOICE_REPEAT_GAP_MS = 3 * 60 * 60 * 1000;

let hooks = {
  getAccountSettings: null,
  ensureDailyLife: null,
  formatClock: null,
};

function configureReplyPipeline(next) {
  hooks = { ...hooks, ...next };
}

async function getAccountSettings(accountId) {
  if (!hooks.getAccountSettings) {
    throw new Error('replyPipeline: getAccountSettings not configured');
  }
  return hooks.getAccountSettings(accountId);
}

function ensureDailyLife(accountId) {
  if (!hooks.ensureDailyLife) {
    throw new Error('replyPipeline: ensureDailyLife not configured');
  }
  return hooks.ensureDailyLife(accountId);
}

function formatClock(totalMinutes) {
  if (!hooks.formatClock) {
    throw new Error('replyPipeline: formatClock not configured');
  }
  return hooks.formatClock(totalMinutes);
}

const LAUGH_TOKEN_RE = /<<\s*LAUGH\s*>>/gi;
const LAUGH_LINES = ['ахаха', 'ахахах', 'ахах', 'ахахаха'];

function peelLaugh(text) {
  const raw = String(text || '').trim();
  if (!raw) return { laugh: false, text: '' };
  if (/^ахах+а?[).!]*$/i.test(raw)) return { laugh: true, text: '' };
  const lead = raw.match(/^(ахах+а?)(?:[).!]+)?(?:\s+|$)/i);
  if (lead) {
    return { laugh: true, text: raw.slice(lead[0].length).trim() };
  }
  const tail = raw.match(/(?:^|\s)(ахах+а?)[).!]*$/i);
  if (tail && tail.index > 0) {
    return { laugh: true, text: raw.slice(0, tail.index).trim() };
  }
  return { laugh: false, text: raw };
}

function splitLaugh(reply) {
  const token = /<<\s*LAUGH\s*>>/i.test(reply);
  const without = String(reply || '').replace(LAUGH_TOKEN_RE, ' ').replace(/[ \t]{2,}/g, ' ').trim();
  const peeled = peelLaugh(without);
  return { text: peeled.text, laugh: token || peeled.laugh };
}

// Реакции Telegram (обычный набор без premium-custom).
const REACT_TOKEN_RE = /<<\s*REACT\s*:\s*([^>\n]+)\s*>>/gi;
const ALLOWED_REACTIONS = new Set([
  '👍', '❤️', '🔥', '😂', '🥰', '👏', '😁', '🤔', '😢', '🎉',
  '🙏', '😍', '😭', '😘', '😮', '👀', '💔', '💯', '🤝', '🤗',
  '😴', '😈', '🤡', '🥴', '🕊', '🍾', '💋', '❤',
]);

function normalizeReactionEmoji(raw) {
  const cleaned = String(raw || '').trim();
  if (!cleaned) return null;
  // Берём первый символ/кластер эмодзи.
  const first = [...cleaned][0];
  if (!first) return null;
  if (ALLOWED_REACTIONS.has(first)) return first;
  // Иногда модель пишет ❤ без вариации — приводим к ❤️
  if (first === '❤') return '❤️';
  // Неизвестный эмодзи — не шлём (Telegram может отклонить).
  return null;
}

/**
 * Вырезает <<REACT:👍>> из ответа модели.
 * Возвращает { text, reaction } — reaction это emoticon или null.
 */
function extractReaction(reply) {
  const raw = String(reply || '');
  const match = raw.match(/<<\s*REACT\s*:\s*([^>\n]+)\s*>>/i);
  const reaction = match ? normalizeReactionEmoji(match[1]) : null;
  const text = raw
    .replace(REACT_TOKEN_RE, '')
    .replace(/\[(?:реакция|reaction)\s*:?[^\]]*\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return { text, reaction };
}

async function sendMessageReaction(client, peer, message, emoticon) {
  const msgId = Number(message?.id);
  if (!client || !peer || !msgId || !emoticon) return false;
  try {
    await client.invoke(
      new Api.messages.SendReaction({
        peer,
        msgId,
        reaction: [new Api.ReactionEmoji({ emoticon })],
      }),
    );
    return true;
  } catch (err) {
    const code = String(err.errorMessage || err.message || '');
    // Уже стоит та же реакция / нечего менять — не ошибка.
    if (/MESSAGE_NOT_MODIFIED|REACTION_INVALID|REACTIONS_TOO_MANY/i.test(code)) {
      return /MESSAGE_NOT_MODIFIED/i.test(code);
    }
    console.error('Не удалось поставить реакцию:', code);
    return false;
  }
}

const STATUS_ASK_RE =
  /что\s+(?:делаешь|поделываешь|там)|чем\s+(?:занят(?:а)?|занимаешься)|как\s+(?:дела|жизнь|ты)(?=$|[\s?!.])|[чc][её]\s+делаешь|(?:^|[\s?])ты\s+где\s*\??\s*$/i;

const SHORT_Q_ASK_RE =
  /^(?:ну\s+|а\s+|эй\s+|слушай\s+|и\s+)?(?:что|чё|че|как|чем|где|куда|когда|почему|зачем|кто|ты)(?=$|[\s?!.])/i;

const EMOTION_REACT_ALLOW_RE =
  /(?:ахах|ахаха|лол|ору|ржу|шутк|прикол|😂|🤣|кек|спасибо|спс|пасиб|мило|красив|😘|❤|❤️|обнима|целую|\[(?:фото|голосовое|видео|кружок)|^(?:ну\s+|да\s+)?(?:ок|окей|ага|угу|ладно|кайф|пон)\s*[)!.]*$)/i;

/**
 * На «что делаешь?» / короткий вопрос — текстом.
 * Эмодзи-реакция только на эмоцию/комплимент/медиа.
 */
function shouldSuppressReaction(userMessage) {
  const t = String(userMessage || '')
    .replace(/^\[[^\]]*\]:\s*/g, '')
    .replace(/\p{Extended_Pictographic}|[\uFE0F\u200D]/gu, '')
    .trim();
  if (!t) return false;
  if (STATUS_ASK_RE.test(t)) return true;
  if (/\?/.test(t) && t.length <= 80 && SHORT_Q_ASK_RE.test(t)) return true;
  // whitelist: шутка / комплимент / медиа — реакцию можно
  const raw = String(userMessage || '');
  if (EMOTION_REACT_ALLOW_RE.test(raw)) return false;
  // всё остальное с реакцией от модели — режем (оставим текст)
  return true;
}

function applyReactionGate(userMessage, reaction, outText, accountId = null, peerId = null) {
  if (!reaction) return { reaction, outText };
  if (!shouldSuppressReaction(userMessage)) {
    return { reaction, outText };
  }
  let text = outText;
  if (!String(text || '').trim()) {
    try {
      text = require('./humanIdeas12').pickStatusAskLine(accountId, peerId);
    } catch (_) {
      text = 'кофе остыл, сижу с телефоном)';
    }
  }
  return { reaction: null, outText: text };
}

function laughedRecently(history) {
  if (!Array.isArray(history)) return false;
  let seen = 0;
  for (let i = history.length - 1; i >= 0 && seen < 3; i--) {
    if (history[i].role !== 'assistant') continue;
    seen += 1;
    if (/^ахах/i.test(String(history[i].content || '').trim())) return true;
  }
  return false;
}

async function sendLaughBubble(client, sender, accountId, peerId, senderName) {
  const phrase = LAUGH_LINES[Math.floor(Math.random() * LAUGH_LINES.length)];
  await sleep(700 + Math.random() * 1100);
  await tgSendMessage(client, sender, { message: phrase });
  await saveMessage(accountId, peerId, senderName, 'assistant', phrase);
  console.log(`[${accountLabel(accountId)}] Смех отдельным сообщением для ${senderName}: "${phrase}"`);
}

/**
 * Срабатывает по таймеру паузы: бот генерирует и отправляет НАСТОЯЩИЙ AI-ответ
 * на сообщение, которое ждало во время «занятости» — так со стороны выглядит
 * будто человек отвлёкся, но всё равно ответил на заданный вопрос, а не забыл
 * про него. Проверяет активность, автоответчик и рабочие часы перед отправкой.
 */
async function fireReengage(accountId, peerId) {
  const key = bufferKey(accountId, peerId);
  if (reengageInFlight.has(key)) {
    console.log(
      `[${accountLabel(accountId)}] Отложенный ответ уже идёт для ${peerId} — дубль таймера пропускаю.`,
    );
    return;
  }
  const entry = deferredDialogs.get(key);
  deferredDialogs.delete(key);
  reengageInFlight.add(key);
  try {
    require('./scaleOps').clearBusy(accountId, peerId).catch(() => {});
  } catch (_) {}
  if (!entry) {
    reengageInFlight.delete(key);
    return;
  }

  let { sender, senderName, history, text, message } = entry;

  const client = getActiveClient(accountId);
  if (!client) {
    reengageInFlight.delete(key);
    return;
  }
  // #12 restore из БД кладёт sender=peerId (строка) — резолвим entity,
  // иначе isPeerArchived fail-closed съедает отложенный ответ.
  if (sender == null || typeof sender === 'string' || typeof sender === 'number') {
    try {
      const ent = await client.getEntity(sender != null ? sender : peerId);
      if (ent) sender = ent;
    } catch (e) {
      console.warn(
        `[${accountLabel(accountId)}] busy reengage: не резолвил peer ${peerId}:`,
        e.message || e,
      );
      reengageInFlight.delete(key);
      return;
    }
  }
  const settings = await getAccountSettings(accountId);
  if (!settings || !settings.is_autoreply_enabled) {
    reengageInFlight.delete(key);
    return;
  }
  if (await isPeerBlacklisted(accountId, peerId)) {
    reengageInFlight.delete(key);
    return;
  }
  // Если этому собеседнику ранее ушло голосовое с просьбой о помощи — проверяем
  // согласие ДО отключения автоответа. Голосовые собеседника уже расшифрованы
  // в текст на этапе extractIncomingText, так ��то распознаётся и голосовой,
  // и текстовый ответ. Проверяем всегда, даже если автоответ уже отключён —
  // иначе после ��ер��ого отключения согласие на ��альнейшие сообщения перестало
  // бы детектиров��ться вовсе.
  await helpRequestNotifier.checkConsent(accountId, peerId, senderName, settings.phone, text, accountLabel(accountId));
  // После отправки голосового с просьбой о помощи автоответ для э��ого
  // конкретного собеседника отключён — дальше ве��ёт оператор вр��чную.
  if (await helpRequestNotifier.isAutoreplyDisabledForPeer(accountId, peerId)) {
    reengageInFlight.delete(key);
    return;
  }
  // Вне режима дня не пишем — кроме незакрытой медиа-просьбы (иначе «лайф» висит до утра).
  // 01–08 МСК всё равно тишина.
  if (isNightTextQuietHour()) {
    reengageInFlight.delete(key);
    return;
  }
  if (!isWithinWorkingHours(accountId) && !isHardMediaRequest(text)) {
    reengageInFlight.delete(key);
    return;
  }
  try {
    const i14 = require('./humanIdeas14');
    const histFarewell = Array.isArray(history) ? history : await getHistory(accountId, peerId);
    if (
      i14.shouldSkipUntilMorning(histFarewell, text, {
        hardMedia: isHardMediaRequest(text, histFarewell),
      })
    ) {
      console.log(
        `[${accountLabel(accountId)}] Отложенный ответ отменён — ${senderName} после спокойной, тишина до утра.`,
      );
      reengageInFlight.delete(key);
      return;
    }
  } catch (_) {
    /* optional */
  }
  // Архив — никогда не читаем и не пишем, в том числе отложенным ответом.
  if (await isPeerArchived(client, sender)) {
    console.log(
      `[${accountLabel(accountId)}] Отложенный ответ отменён — ${senderName} в архиве.`,
    );
    reengageInFlight.delete(key);
    return;
  }
  // «Удалить у меня и у собеседника» — триггер-сообщения уже нет, не пишем в пустой чат.
  if (await cancelReplyIfDialogGone(client, accountId, sender, senderName, message, 'отложенный')) {
    reengageInFlight.delete(key);
    return;
  }

  // Howlong-отсев и в отложенном ответе (иначе «месяц» в busy-pending утекает из архива).
  try {
    const histHow = Array.isArray(history) ? history : await getHistory(accountId, peerId);
    if (isAnswerToHowLong(histHow)) {
      const stayDays = parseStayDays(text);
      console.log(
        `[${accountLabel(accountId)}] ${senderName} ответил (reengage), сколько на дв: "${String(text).slice(0, 80)}" → ${stayDays ?? '?'} дн.`,
      );
      if (stayDays != null && stayDays >= HOWLONG_ARCHIVE_DAYS) {
        await markPeerAsRead(client, sender, message);
        try {
          const leadScoring = require('./leadScoring');
          const { formatFilterNote } = require('./opsQuality');
          await leadScoring.markPeerFiltered(
            accountId,
            peerId,
            formatFilterNote('howlong', `${stayDays} дн. (≥${HOWLONG_ARCHIVE_DAYS})`),
          );
        } catch (e) {
          console.error(
            `[${accountLabel(accountId)}] Не удалось пометить отсев ${senderName}:`,
            e.message,
          );
        }
        try {
          await archivePeer(client, sender);
        } catch (e) {
          console.error(
            `[${accountLabel(accountId)}] Не удалось архивировать ${senderName}:`,
            e.errorMessage || e.message,
          );
        }
        console.log(
          `[${accountLabel(accountId)}] ${senderName} на дв ${stayDays} дн. (≥${HOWLONG_ARCHIVE_DAYS}) — отсев + архив (reengage).`,
        );
        reengageInFlight.delete(key);
        return;
      }
    }
  } catch (e) {
    console.warn(
      `[${accountLabel(accountId)}] howlong reengage:`,
      e?.message || e,
    );
  }

  let workMentionClaimed = false;
  try {
    const mediaLink =
      typeof settings.media_chat_link === 'string'
        ? settings.media_chat_link.trim()
        : '';
    const sexualPressure = objectionHandler.isSexualPressure(text);
    // История до флагов медиа: долг «щас скину» должен пережить паузу «Занята».
    const histForMedia = await getHistory(accountId, peerId);
    const histMediaBase = histForMedia.length ? histForMedia : history;
    let mediaDebt = unfulfilledMediaPromiseCount(histMediaBase) > 0;
    if (!mediaDebt && humanHardening.peekDueDeferredMedia(accountId, peerId)) {
      mediaDebt = true;
      humanHardening.takeDueDeferredMedia(accountId, peerId);
    }
    const topicPhoto =
      !sexualPressure &&
      !!mediaLink &&
      isTopicPhotoRequest(text) &&
      !lastAssistantWasMedia(histMediaBase);
    const hardMediaRequest = !sexualPressure && isHardMediaRequest(text, histMediaBase);
    const explicitMediaRequest = hardMediaRequest || topicPhoto || mediaDebt;
    // Отложенный ответ тоже должен отдавать медиа, если человек просил /
    // был долг обещания — иначе после «Занята» фото пропадает.
    const mediaEnabled = !!mediaLink && explicitMediaRequest;
    const leadSnap = await leadScoring.getPeerScoreSnapshot(accountId, peerId);
    const opsQ = require('./opsQuality');
    let contextualCircle =
      !!mediaLink && !explicitMediaRequest && (await canSendContextualCircle(accountId, peerId, history));
    if (contextualCircle && !opsQ.allowProactiveMedia(leadSnap?.tier, false)) {
      contextualCircle = false;
    }
    const noMediaExcuse = explicitMediaRequest && !mediaLink;
    const nft = await getNftCampaignState(accountId, peerId, history.length, {
      leadTier: leadSnap?.tier,
    });
    const suppressNft = await shouldSuppressNftForTurn(text, {
      flipPhotoQuestion: false,
      explicitMediaRequest,
      history,
      accountId,
      peerId,
    });
    if (suppressNft) {
      nft.hint = null;
      nft.sendVoice = false;
      nft.sayWorkProblem = false;
    }
    if (!isRussianConversation(text, history)) {
      nft.sendVoice = false;
    }

    // Динамический тайм-менеджмент + Mood Engine + Memory Triggers +
    // обработка возражений/анти-детект — см. соответствующие модули.
    const timeInfo = getAccountTimeStyle(accountId);
    if (timeInfo.isSleep && !isHardMediaRequest(text)) {
      console.log(`[${accountLabel(accountId)}] Спит по режиму дня — пропускаем ответ ${senderName}`);
      return;
    }
    const moodInfo = await moodEngine.getConversationMood(accountId, peerId, text);
    const accountMood = await moodEngine.getMood(accountId);
    const personaHint = await accountPersona.buildPersonaHint(accountId);
    const slangHint = humanExtra.slangHintForAccount(accountId);
    const dueMemory = await memoryTriggers.getDueFollowUp(accountId, peerId);
    const msgDateRe =
      message?.date != null
        ? new Date(Number(message.date) * (Number(message.date) < 1e12 ? 1000 : 1))
        : null;
    const morningHint = humanExtra.needsMorningApology(msgDateRe)
      ? humanExtra.morningApologyHint()
      : null;
    const awayMin = await humanExtra.lastAssistantAgeMinutes(accountId, peerId);
    const awayHint = morningHint ? null : humanExtra.awayReturnHint(awayMin);
    let detailHint = humanExtra.buildHisDetailCallbackHint(history, text);
    {
      const evening = await require('./replyPipelineShared').buildEveningRecallHintSafe(
        accountId,
        peerId,
      );
      if (evening) detailHint = detailHint ? `${detailHint}\n${evening}` : evening;
    }
    const liveHistory = histForMedia.length ? histForMedia : await getHistory(accountId, peerId);
    // Перед scheduleReengage user уже saveMessage — не дублируем turn в generateReply.
    let replyHistory = liveHistory.length ? liveHistory : history;
    const lastHist = replyHistory[replyHistory.length - 1];
    if (
      lastHist?.role === 'user' &&
      String(lastHist.content || '').trim() === String(text || '').trim()
    ) {
      replyHistory = replyHistory.slice(0, -1);
    }
    const flipPhotoQuestion = await objectionHandler.shouldForceReplyForFlipPhoto(
      text,
      replyHistory,
      accountId,
      peerId,
    );
    const dialogAgeHours = await getDialogAgeHours(accountId, peerId);
    // How-long ack важнее generic later/dont_understand — иначе «потом» съедает реакцию на дв.
    let objectionHint = null;
    let ownAvatarHitEarly = false;
    try {
      ownAvatarHitEarly = require('./avatarMatch').messageHasOwnAvatarTag(text);
    } catch (_) {}
    if (ownAvatarHitEarly && typeof objectionHandler.getOwnAvatarClaimHint === 'function') {
      objectionHint = objectionHandler.getOwnAvatarClaimHint();
    } else if (flipPhotoQuestion) {
      objectionHint = objectionHandler.getFlipPhotoQuestionHint();
    } else if (isAnswerToHowLong(replyHistory)) {
      objectionHint = objectionHandler.getHowLongAckHint(text);
    } else {
      objectionHint = objectionHandler.detectHint(text, replyHistory, {
        systemPrompt: settings.prompt,
        dialogAgeHours,
      });
    }
    {
      const hhExtra = humanHardening.buildHardeningHints(text, replyHistory, {
        accountId,
        peerId,
        skipClone: true,
        systemPrompt: settings.prompt,
      });
      if (hhExtra) {
        objectionHint = objectionHint ? `${objectionHint}\n${hhExtra}` : hhExtra;
      }
      const burst = humanHardening.getBurstReplyHint(text);
      if (burst) {
        objectionHint = objectionHint ? `${objectionHint}\n${burst}` : burst;
      }
      try {
        const leads = require('./humanRhythm').whoLeadsHint(replyHistory, text);
        if (leads) {
          objectionHint = objectionHint ? `${objectionHint}\n${leads}` : leads;
        }
      } catch (_) {
        /* optional */
      }
    }
    let peerFactsForForget = [];
    try {
      peerFactsForForget = await memoryTriggers.listPeerFacts(accountId, peerId);
      const forgetH = require('./humanRhythm').honestForgetHint(text, peerFactsForForget);
      if (forgetH) {
        objectionHint = objectionHint ? `${objectionHint}\n${forgetH}` : forgetH;
      }
    } catch (_) {
      peerFactsForForget = [];
    }
    const complimentHint = await complimentEngine.getComplimentHint(accountId, peerId, text);
    // На прямой вопрос memory follow-up часто уводит в «философию» вместо ответа.
    const useMemoryHint =
      dueMemory?.hint && !objectionHandler.isDirectQuestion(text) ? dueMemory.hint : null;

    // Обучение на прошлом опыте: сначала оцениваем реакцию собеседника на
    // предыдущие ответы бота (окно из нескольких сообщений — см.
    // learningDb.js), затем достаём лучшие/худшие фразы ТОГО ЖЕ ЭТАПА
    // диалога для подмешивания в промпт текущего ответа.
    const learningStage = learningDb.detectStage({ objectionHint, nftHint: nft.hint, historyLength: history.length });
    await learningDb.scoreAndLearn(accountId, peerId, text);
    const ragDay = ragExamples.dialogDayFromAgeHours(dialogAgeHours);
    // Только его последние реплики — меньше шума от её ответов в эмбеде.
    const ragHistoryHint = (Array.isArray(replyHistory) ? replyHistory : [])
      .filter((h) => h && h.role === 'user')
      .slice(-3)
      .map((h) => String(h.content || '').replace(/\[реакция:[^\]]*\]/gi, '').trim().slice(0, 120))
      .filter(Boolean)
      .join('\n');
    const [learningSnippet, manualSnippet, ragSnippet] = await Promise.all([
      learningDb.buildLearningSnippet(learningStage, { accountId, peerId }),
      learningDb.buildManualTrainingSnippet(accountId, text),
      ragExamples.buildRagSnippet(ragDay, text, ragHistoryHint),
    ]);
    // Факт + стиль чата запоминаем «на будущее» (не блокирует ответ).
    memoryTriggers.extractAndSaveFact(accountId, peerId, text).catch(() => {});
    peerProfile.maybeUpdate(accountId, peerId, replyHistory).catch(() => {});

    const emotionHint = buildEmotionHint(replyHistory);
    const sessionForgetHint = buildSessionForgetHint(replyHistory.length <= 4);
    const memoryContextHint = sessionForgetHint
      ? null
      : await memoryTriggers.buildMemoryContextHint(accountId, peerId);
    const peerProfileHint = await peerProfile.buildHint(accountId, peerId);
    const externalFactHint = await externalFacts.buildExternalFactHint(
      settings.prompt,
      text,
    );

    // Без typing во время AI: иначе «печатает» при непрочитанном — палево.
    let rawReply;
    if (!settings.prompt || !String(settings.prompt).trim()) {
      console.error(
        `[${accountLabel(accountId)}] Промпт пустой — AI не отвечаю (нужен промпт в кабинете).`,
      );
      return;
    }
    rawReply = await generateReply(settings.prompt, replyHistory, text, {
      mediaEnabled,
      contextualCircle,
      noMediaExcuse,
      topicPhoto,
      campaignHint: suppressNft || flipPhotoQuestion ? null : nft.hint,
      learningSnippet,
      manualSnippet,
      ragSnippet,
      timeHint: timeInfo.hint,
      moodHint: moodInfo.hint,
      accountMoodHint: accountMood.hint || null,
      flashEmotion: moodInfo.flash || null,
      personaHint,
      slangHint,
      emotionHint,
      sessionForgetHint,
      memoryContextHint,
      memoryHint: sessionForgetHint ? null : useMemoryHint,
      objectionHint,
      complimentHint,
      morningApologyHint: morningHint,
      awayReturnHint: awayHint,
      hisDetailHint: detailHint,
      peerProfileHint,
      externalFactHint,
      accountId,
      peerId,
      dialogAgeHours,
    });
    if (!rawReply) {
      console.error(
        `[${accountLabel(accountId)}] AI не дал ответ для ${senderName} — молчу (без soft-fill).`,
      );
      return;
    }
    rawReply = sanitizeReplyAgainstNftLeak(rawReply, objectionHint);
    try {
      rawReply = require('./humanRhythm').applyHonestForget(
        rawReply,
        text,
        peerFactsForForget,
      );
    } catch (_) {
      /* optional */
    }
    if (sexualPressure || objectionHandler.isNudeAsk(text)) {
      rawReply = objectionHandler.softenSexualPressureReply(rawReply, text);
    }
    rawReply = objectionHandler.softenFakeAccusationReply(rawReply, text);
    if (typeof objectionHandler.softenFraudAdmissionReply === 'function') {
      rawReply = objectionHandler.softenFraudAdmissionReply(rawReply, text, replyHistory);
    }
    {
      let matchesOwnAvatar = false;
      try {
        const am = require('./avatarMatch');
        matchesOwnAvatar = am.messageHasOwnAvatarTag(text);
      } catch (_) {}
      if (typeof objectionHandler.softenFlipPhotoIdentityReply === 'function') {
        rawReply = objectionHandler.softenFlipPhotoIdentityReply(rawReply, text, replyHistory, {
          flipRecent: Boolean(flipPhotoQuestion),
          matchesOwnAvatar,
        });
      }
      if (typeof objectionHandler.softenClaimedHerPhotoReply === 'function') {
        rawReply = objectionHandler.softenClaimedHerPhotoReply(rawReply, text, {
          matchesOwnAvatar,
        });
      }
    }
    if (humanHardening.detectDeferredMediaPromise(rawReply)) {
      const job = humanHardening.scheduleDeferredMedia(accountId, peerId, { kind: 'photo' });
      try {
        require('./inbound').scheduleDeferredMediaReturn(
          accountId,
          sender,
          peerId,
          senderName,
          job,
        );
      } catch (_) {
        /* optional */
      }
    }
    rawReply = externalFacts.groundClockReply(rawReply, settings.prompt, text);
    // echoLength / antiMirror уже в finalize aiResponder — второй раз не режем.
    if (dueMemory && useMemoryHint && !sessionForgetHint) memoryTriggers.markFollowedUp(dueMemory.id).catch(() => {});

    const { text: replyWithoutLaugh, laugh } = splitLaugh(rawReply);
    let { text: replyWithoutReact, reaction } = extractReaction(replyWithoutLaugh);
    {
      const gated = applyReactionGate(text, reaction, replyWithoutReact, accountId, peerId);
      if (reaction && !gated.reaction) {
        console.log(
          `[${accountLabel(accountId)}] Реакцию снял (вопрос/не эмоция) от ${senderName}.`,
        );
      }
      reaction = gated.reaction;
      replyWithoutReact = gated.outText;
    }
    try {
      if (require('./humanIdeas12').detectDeferredInterest(replyWithoutReact)) {
        humanHardening.scheduleDeferredText(accountId, peerId, {
          delayMs: 45 * 60 * 1000 + Math.floor(Math.random() * 3 * 3600 * 1000),
          reason: 'deferred_interest',
        });
      }
    } catch (_) {
      /* optional */
    }
    const {
      text: reply,
      mediaType: rawMediaType,
      fromLeak: mediaFromLeak,
    } = extractMediaRequest(replyWithoutReact);

    let mediaType = rawMediaType;
    if (explicitMediaRequest && mediaLink && !mediaType) {
      mediaType = detectRequestedMediaType(text);
    }
    if (sexualPressure && mediaType) {
      console.log(`[${accountLabel(accountId)}] Подавил медиа на секс-давление от ${senderName}.`);
      mediaType = null;
    }
    // Без прямой просьбы — НЕ шлём фото/видео (кроме утечки «[фото билета]» → реальный файл).
    if (!explicitMediaRequest && !mediaFromLeak) {
      if (mediaType && mediaType !== 'circle') {
        if (rawMediaType === 'photo' || rawMediaType === 'video') {
          console.log(
            `[${accountLabel(accountId)}] Подавил незапрошенное ${rawMediaType} для ${senderName}.`,
          );
        }
        mediaType = null;
      }
      if (mediaType === 'circle' && !contextualCircle) mediaType = null;
    }
    if (mediaFromLeak && mediaType && mediaLink) {
      console.log(
        `[${accountLabel(accountId)}] Утечка псевдо-медиа → шлю реальный ${mediaType} для ${senderName}.`,
      );
    }
    if (mediaType && !explicitMediaRequest && !mediaFromLeak && lastAssistantWasMedia(history)) {
      mediaType = null;
    }
    // Сомнение в свежести медиа — новый файл не шлём (см. peerComplainedMediaNotFresh).
    if (mediaType && peerComplainedMediaNotFresh(text, history)) {
      console.log(
        `[${accountLabel(accountId)}] Подавил медиа (${mediaType}) для ${senderName}: он сомневается, что оно свежее.`,
      );
      mediaType = null;
    }
    // Требование «докажи, что ты реальная» + свежий отказ от видео — см.
    // комментарии в основной ветке обработки.
    if (mediaType && peerAsksToProveHuman(text)) {
      console.log(
        `[${accountLabel(accountId)}] Подавил медиа (${mediaType}) для ${senderName}: он требует доказать, что я реальная.`,
      );
      mediaType = null;
    }
    if (mediaType && botRecentlyRefusedVideo(history) && (await mediaRefusalQuietNow(accountId, peerId))) {
      console.log(
        `[${accountLabel(accountId)}] Подавил медиа (${mediaType}) для ${senderName}: только что отказалась от видео, рано присылать.`,
      );
      mediaType = null;
    }
    // Must #55: не слать медиа сразу после питча/профит-скрина.
    if (
      mediaType &&
      !explicitMediaRequest &&
      !mediaFromLeak &&
      (await humanHardening.shouldBlockMediaAfterPitchAsync(accountId, peerId))
    ) {
      console.log(
        `[${accountLabel(accountId)}] skip reason=media_after_pitch peer=${senderName} type=${mediaType}`,
      );
      mediaType = null;
    }
    // #16: не слать фото сразу после «не покажу»
    try {
      const i14 = require('./humanIdeas14');
      if (mediaType && i14.shouldBlockMediaAfterNoShow(history)) {
        console.log(
          `[${accountLabel(accountId)}] skip reason=media_after_noshow peer=${senderName} type=${mediaType}`,
        );
        mediaType = null;
      }
    } catch (_) {
      /* optional */
    }

    let outText = reply;
    if (!outText && rawMediaType && !mediaType && !reaction) {
      const fillers = ['да по делам)', 'та так, по своим)', 'ничего особенного)', 'да ничё такого)'];
      outText = fillers[Math.floor(Math.random() * fillers.length)];
    }
    // Nice #20/#7: на короткое «ок/ага» чаще реакция без текста.
    if (
      !mediaType &&
      !nft.sendVoice &&
      humanHardening.preferReactionOnlyOnBareOk(text, outText, { leadTier: leadSnap?.tier })
    ) {
      if (!reaction) reaction = ['👍', '👌', '🥰'][Math.floor(Math.random() * 3)];
      outText = '';
    }
    // «ничего особенного)» вместо обещанного файла — форсим фото.
    if (
      mediaLink &&
      !mediaType &&
      (explicitMediaRequest || unfulfilledMediaPromiseCount(history) > 0) &&
      BARE_MEDIA_FILLER_RE.test(String(outText || '').trim())
    ) {
      mediaType = 'photo';
      outText = '';
      console.log(
        `[${accountLabel(accountId)}] Филлер вместо медиа → шлю photo для ${senderName}.`,
      );
    }

    if (mediaType && mediaEnabled) {
      // Lazy: циклический require mediaSend↔pipeline иначе даёт undefined.
      const mediaHelpers = require('./mediaSend');
      if (mediaHelpers.isContradictoryMediaText(outText)) {
        console.log(
          `[${accountLabel(accountId)}] Убрал отказной текст перед медиа для ${senderName}: "${outText}"`,
        );
        outText = mediaHelpers.stripContradictoryMediaParts(outText);
      }
    }
    let forcedMediaThisTurn = false;
    {
      const resolved = resolveMediaPromise(
        outText,
        mediaType && mediaLink ? mediaType : null,
        text,
        history,
        !!mediaLink,
      );
      if (resolved.packedThings) {
        mediaType = null;
        forcedMediaThisTurn = false;
        outText = resolved.outText;
        console.log(
          `[${accountLabel(accountId)}] Вещи/коробки — без фото для ${senderName}: "${outText}"`,
        );
      } else if (resolved.forceMedia && mediaLink) {
        mediaType = mediaType || (resolved.preferPhoto ? 'photo' : detectRequestedMediaType(text));
        if (resolved.preferPhoto) mediaType = 'photo';
        forcedMediaThisTurn = true;
        console.log(
          `[${accountLabel(accountId)}] Обещание медиа → отправляю ${mediaType} для ${senderName}` +
            (resolved.outText !== outText ? `: "${outText}" → "${resolved.outText || '(без текста)'}"` : ''),
        );
        outText = resolved.outText;
      } else if (resolved.outText !== outText) {
        console.log(
          `[${accountLabel(accountId)}] Обещание медиа без отправки для ${senderName}: "${outText}" → "${resolved.outText}"`,
        );
        outText = resolved.outText;
      }
    }
    // Дубль-гейт: явная просьба фото вещей — не шлём селфи мимо темы.
    try {
      const ms = require('./mediaSend');
      if (mediaType && ms.isPackedThingsPhotoAsk(text, history)) {
        console.log(
          `[${accountLabel(accountId)}] skip reason=packed_things_unavailable peer=${senderName}`,
        );
        mediaType = null;
        forcedMediaThisTurn = false;
        if (!outText || isMediaPromiseText(outText) || /найду\s+(?:нормальн\w*\s+)?фото/i.test(outText)) {
          outText = ms.pickPackedThingsExcuse();
        }
      }
    } catch (_) {
      /* optional */
    }
    if (mediaType && mediaLink) {
      const beforeAck = outText;
      outText = ensureMediaAckText(outText, mediaType);
      if (beforeAck !== outText) {
        console.log(
          `[${accountLabel(accountId)}] Медиа-ack вместо отказа для ${senderName}: "${beforeAck || ''}" → "${outText}"`,
        );
      }
    }

    // Не слать «щас по работе» поверх «щас скину милое» / фото.
    const pendingWorkAside =
      !!nft.sayWorkProblem &&
      !mediaType &&
      !forcedMediaThisTurn &&
      !explicitMediaRequest &&
      !isMediaPromiseText(outText);
    if (mediaType || forcedMediaThisTurn || explicitMediaRequest) {
      nft.sendVoice = false;
    }

    const reactionOnly = !!reaction && !outText && !mediaType && !nft.sendVoice;
    let lateTextMs = humanExtra.reactThenTextDelayMs(accountId, reaction, outText);
    try {
      lateTextMs = require('./humanRhythm').boostReactThenTextMs(
        lateTextMs,
        text,
        reaction,
        outText,
      );
    } catch (_) {
      /* optional */
    }

    // Read → dwell → typing → send (не typing до прочтения).
    let delayMs = opsQ.applyTempoDelay(
      delayBeforeSendMs(settings, outText, { accountId, incomingText: text }),
      leadSnap?.tier,
    );
    let typeBudget = Math.min(computeTypingMs(outText, accountId), delayMs);
    try {
      const shaped = require('./humanRhythm').reshapeDelayPair({
        baseDelayMs: delayMs,
        outText,
        incomingText: text,
        accountId,
      });
      delayMs = shaped.delayMs;
      typeBudget = shaped.typingMs;
    } catch (_) {
      /* optional */
    }
    let reengageLifeLag = false;
    if (!explicitMediaRequest && !mediaType) {
      try {
        const lag = require('./humanIdeas10').maybeLifeLagMs(text, { leadTier: leadSnap?.tier });
        if (lag > delayMs) {
          delayMs = lag;
          reengageLifeLag = true;
        }
      } catch (_) {
        /* optional */
      }
    }
    if (!reengageLifeLag) delayMs = Math.min(delayMs, 14_000);
    if (reactionOnly || (reaction && lateTextMs > 0)) {
      await markPeerAsRead(client, sender, null);
      await sleep(800 + Math.floor(Math.random() * 2200));
    } else {
      console.log(
        `[${accountLabel(accountId)}] Пауза ${Math.round(delayMs / 1000)}с перед отложенным ответом для ${senderName}.`,
      );
      await humanPauseBeforeSend(
        client,
        sender,
        null,
        delayMs,
        Math.min(typeBudget, delayMs),
        text,
        accountId,
      );
      if (await abortIfPausedOrBlacklisted(accountId, peerId, senderName, 'после паузы (reengage)')) {
        return;
      }
    }

    if (reaction && message) {
      const ok = await sendMessageReaction(client, sender, message, reaction);
      if (ok) {
        lastReplyAt.set(bufferKey(accountId, peerId), Date.now());
        await saveMessage(accountId, peerId, senderName, 'assistant', `[реакция:${reaction}]`);
        console.log(
          `[${accountLabel(accountId)}] Отложенная реакция ${reaction} для ${senderName}.`,
        );
      }
    }

    if (outText && lateTextMs > 0) {
      await sleep(lateTextMs);
      const typeMs = Math.min(2800, computeTypingMs(outText, accountId));
      waitBeforeReply._rethinkChance = humanExtra.getAccountPace(accountId).rethinkChance;
      await waitBeforeReply(client, sender, typeMs, typeMs);
      waitBeforeReply._rethinkChance = undefined;
    }

    if (outText) {
      // fireReengage не выбирает voice-файл — не трогаем voice?. (ReferenceError: voice is not defined).
      try {
        outText = require('./aiResponderPostprocess').finalizeOutgoingReply(outText, text, {
          history,
          voiceFileName: null,
        });
      } catch (_) {
        /* optional */
      }
      outText = prepareOutboundText(outText, {
        voiceFileName: null,
        history,
        accountId,
      });
      if (outText) {
        await sendHumanText(client, sender, accountId, peerId, senderName, outText, text);
        lastReplyAt.set(bufferKey(accountId, peerId), Date.now());
        await learningDb.recordBotReply(accountId, peerId, text, stripQuestionTags(outText), learningStage);
        console.log(
          `[${accountLabel(accountId)}] Отложенный ответ для ${senderName}: "${stripQuestionTags(outText)}"`,
        );
        scheduleAfterthought(accountId, sender, peerId, senderName, outText);
        if (humanHardening.detectLaterTextPromise(outText)) {
          scheduleLaterTextReturn(accountId, sender, peerId, senderName);
        }
      }
    }

    if (laugh && !nft.sendVoice && !reactionOnly && !laughedRecently(history)) {
      await sendLaughBubble(client, sender, accountId, peerId, senderName);
    }

    let mediaSentThisTurn = false;
    let mediaFailReason = null;
    if (mediaType && mediaLink) {
      humanHardening.logOutboundReason(accountId, accountLabel(accountId), 'media', {
        peer: senderName,
        type: mediaType,
        explicit: explicitMediaRequest ? 1 : 0,
        leak: mediaFromLeak ? 1 : 0,
      });
      const leakHint = /билет|ticket|скрин|прибыл/i.test(String(replyWithoutReact || ''))
        ? ' билет'
        : '';
      const mediaResult = await sendRequestedMediaOrDeflect(
        client,
        sender,
        accountId,
        peerId,
        senderName,
        mediaType,
        mediaLink,
        // outText («в пижаме») в контексте — иначе pick шлёт outdoor мимо слов.
        buildMediaContextText(
          `${outText || ''} ${(text || '') + leakHint}`.trim(),
          replyHistory,
        ),
        { allowDeflect: explicitMediaRequest || mediaFromLeak || forcedMediaThisTurn },
      );
      mediaSentThisTurn = mediaResult === true || mediaResult?.ok === true;
      if (!mediaSentThisTurn) mediaFailReason = mediaResult?.reason || null;
    }
    await maybeNotifyMediaMissed({
      accountId,
      peerId,
      senderName,
      settings,
      explicitMediaRequest: explicitMediaRequest || mediaFromLeak || forcedMediaThisTurn,
      mediaLink,
      mediaSentThisTurn,
      mediaType,
      text,
      failReason: mediaFailReason,
    });

    // Третий день знакомства — голосовое с просьбой помочь с NFT-токеном
    // (не в тот же ход, когда уже ушло медиа).
    if (nft.sendVoice && !mediaSentThisTurn) {
      const nftPath = path.join(VOICES_DIR, NFT_VOICE_FILE);
      if (fs.existsSync(nftPath) && !(await wasVoiceSent(accountId, peerId, NFT_VOICE_FILE))) {
        try {
          await client.invoke(
            new Api.messages.SetTyping({
              peer: sender,
              action: new Api.SendMessageRecordAudioAction(),
            }),
          );
        } catch (_) {
          // индикатор не критичен
        }
        await sleep(4000 + Math.random() * 3000);
        humanHardening.logOutboundReason(accountId, accountLabel(accountId), 'nft_voice', {
          peer: senderName,
          file: NFT_VOICE_FILE,
        });
        await sendVoiceReply(client, sender, nftPath);
        humanHardening.notePitchSent(accountId, peerId);
        await saveMessage(
          accountId,
          peerId,
          senderName,
          'assistant',
          voiceTag(NFT_VOICE_FILE),
        );
        const accountProfile = await client.getMe();
        const accountName = [accountProfile.firstName, accountProfile.lastName]
          .filter(Boolean)
          .join(' ') || (accountProfile.username ? `@${accountProfile.username}` : '');
        await helpRequestNotifier.recordVoiceSent(
          accountId,
          peerId,
          senderName,
          NFT_VOICE_FILE,
          settings.phone,
          accountName,
        );
        await helpRequestNotifier.disableAutoreplyForPeer(accountId, peerId, 'nft_voice_sent');
        try {
          const leadScoring = require('./leadScoring');
          await leadScoring.onLeadBecameReady(accountId, peerId, 'nft_voice_sent');
        } catch (e) {
          console.error(`[${accountLabel(accountId)}] leadReady:`, e.message);
        }
        console.log(
          `[${accountLabel(accountId)}] Отправлено голосовое про NFT (3-й день) для ${senderName}.`,
        );
      }
    }

    // «сколько дней на дв» — и в отложенном ответе (раньше спрашивали только
    // в основной ветке, из‑за этого часть диалогов оставалась без вопроса).
    // Не спрашивать в ход с просьбой кружка/фото — выглядит как уход от темы.
    if (
      outText &&
      !nft.sendVoice &&
      !mediaSentThisTurn &&
      !detectRequestedMediaType(text) &&
      !/\?[)\s]*$/.test(stripQuestionTags(outText)) &&
      extractUserQuestions(text).length === 0 &&
      (await shouldAskHowLong(accountId, peerId))
    ) {
      const inFlightKey = bufferKey(accountId, peerId);
      howLongInFlight.add(inFlightKey);
      try {
        const question = buildHowLongQuestion();
        await sleep(2500 + Math.random() * 3500);
        try {
          await client.invoke(
            new Api.messages.SetTyping({ peer: sender, action: new Api.SendMessageTypingAction() }),
          );
        } catch (_) {}
        await sleep(1500 + Math.random() * 1500);
        await tgSendMessage(client, sender, { message: question });
        await saveMessage(accountId, peerId, senderName, 'assistant', question);
        lastReplyAt.set(inFlightKey, Date.now());
        console.log(`[${accountLabel(accountId)}] Спросила ${senderName}: "${question}"`);
      } finally {
        howLongInFlight.delete(inFlightKey);
      }
    }
  } catch (e) {
    if (workMentionClaimed) await releaseWorkMention(accountId, peerId).catch(() => {});
    console.error(
      `[${accountLabel(accountId)}] Не удалось отправить отложенный ответ ${senderName}:`,
      e.errorMessage || e.message,
    );
  } finally {
    reengageInFlight.delete(key);
  }
}

/**
 * Основн��я логика ответа: фильтр архива, голосовые загот��вки,
 * гене����ация AI-ответа с учётом истории и отправка собеседнику.
 * ��аботает уже ��о СКЛЕЕННЫМ текстом всех сообщений серии.
 */

/** Опечатка + правка «*слово» отключены: в живых чатах выглядят как бот. */
function maybeTypoPair(text) {
  return null;
}

const Q_TAG_RE = /<<\s*Q\s*:\s*([\d,]+)\s*>>\s*/gi;

function stripQuestionTags(text) {
  return String(text || '')
    .replace(Q_TAG_RE, '')
    // Пустые/битые теги «<<>>» / «<<  >>» — не в чат.
    .replace(/<<\s*>>/g, '')
    .replace(/<<(?!\s*Q\s*:)[^>]{0,40}>>/gi, '')
    // Подстраховка: если [2] всё же проскочил в текст (не в <<Q:>>)
    .replace(/\s*\[\s*\d+(?:\s*,\s*\d+)*\s*\]\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Строки ответа + номер вопроса из тега <<Q:n>> (пустые строки выкидываем вместе с тегом). */
function parseReplyBubbles(outText) {
  const bubbles = [];
  for (const raw of String(outText || '').split(/\n+/)) {
    const m = raw.match(/<<\s*Q\s*:\s*([\d,]+)\s*>>/i);
    const text = raw.replace(Q_TAG_RE, '').trim();
    if (!text) continue;
    // «устала*» / «*устала» — самоисправление, не отдельное сообщение
    if (isTypoFixMessage(text)) continue;
    const nums = m ? m[1].split(',').map(Number).filter((n) => n > 0) : [];
    bubbles.push({ text, q: nums[0] || null });
  }
  return bubbles;
}

const normForMatch = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, '');

/**
 * Для каждой строки ответа — id входящего сообщения с её вопросом (reply).
 * Входящие берём из Telegram (серия после нашего последнего сообщения):
 * буфер хранит только склеенный текст, без id.
 */
async function resolveReplyTargets(client, sender, bubbles, incomingText) {
  const none = bubbles.map(() => null);
  const questions = extractUserQuestions(incomingText);
  if (questions.length < 2) return none;

  let recent;
  try {
    recent = await client.getMessages(sender, { limit: 15 });
  } catch (_) {
    return none;
  }
  const incoming = [];
  for (const m of recent || []) {
    if (!m) continue;
    if (m.out) break;
    incoming.push(m);
  }
  // Один входящий — reply на него бессмысленен.
  if (incoming.length < 2) return none;
  incoming.reverse();

  const findMsgId = (qi) => {
    const q = normForMatch(questions[qi - 1]);
    if (q.length < 3) return null;
    for (const m of incoming) {
      const t = normForMatch(m.message);
      if (t.length < 2) continue;
      if (t.includes(q) || (t.length >= 4 && q.includes(t))) return m.id;
    }
    return null;
  };

  const noTags = bubbles.every((b) => !b.q);
  const used = new Set();
  return bubbles.map((b, i) => {
    const qi = b.q || (noTags && bubbles.length === questions.length ? i + 1 : null);
    const id = qi ? findMsgId(qi) : null;
    if (!id || used.has(id)) return null;
    used.add(id);
    return id;
  });
}

/**
 * Чистит текст перед sendMessage: нули/битые суррогаты ломают MTProto JSON
 * («400 Invalid body: failed to parse JSON value»).
 */
function sanitizeOutgoingText(text) {
  let s = String(text ?? '');
  s = s.replace(/\u0000/g, '');
  // Непарные UTF-16 суррогаты.
  s = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '');
  s = s.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  // Метка истории «[голосовое: file.ogg]» никогда не должна уйти текстом в TG.
  s = s.replace(/\[\s*голосовое\s*:[^\]]*\]/gi, '');
  try {
    s = s.normalize('NFC');
  } catch (_) {
    /* ignore */
  }
  return s.trim();
}

async function tgSendMessage(client, peer, opts) {
  const next = { ...opts };
  if (typeof next.message === 'string') {
    next.message = sanitizeOutgoingText(next.message);
    if (!next.message) return null;
  }
  return client.sendMessage(peer, next);
}

configureMediaSend({
  tgSendMessage: (client, peer, opts) => tgSendMessage(client, peer, opts),
});

/** Последний исходящий текст по диалогу — анти-дубль silence-heal×busy. */
const lastOutboundByPeer = new Map();

function pruneLastOutboundByPeer(now = Date.now()) {
  for (const [k, v] of lastOutboundByPeer) {
    if (!v || now - v.at > 30 * 60_000) lastOutboundByPeer.delete(k);
  }
}

function normalizeOutbound(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNearDupOutbound(accountId, peerId, text) {
  if (lastOutboundByPeer.size > 800) pruneLastOutboundByPeer();
  const key = bufferKey(accountId, peerId);
  const prev = lastOutboundByPeer.get(key);
  if (!prev || Date.now() - prev.at > 4 * 60_000) return false;
  const a = normalizeOutbound(prev.text);
  const b = normalizeOutbound(text);
  if (!a || !b || a.length < 12 || b.length < 12) return false;
  if (a === b) return true;
  const head = (s) => s.slice(0, Math.min(36, s.length));
  return a.includes(head(b)) || b.includes(head(a));
}

async function sendHumanText(client, sender, accountId, peerId, senderName, outText, incomingText = '') {
  // Никогда не слать в Telegram служебные `[медиа:#…]` — только живой текст.
  outText = stripLeakedMediaHistoryTag(outText).text;
  outText = sanitizeOutgoingText(outText);
  // Пустые <<>> до parse — иначе уедут в Telegram; <<Q:n>> не трогаем.
  outText = String(outText || '')
    .replace(/<<\s*>>/g, '')
    .replace(/<<(?!\s*Q\s*:)[^>]{0,40}>>/gi, '');
  if (!outText) return;
  if (isNearDupOutbound(accountId, peerId, outText)) {
    console.log(
      `[${accountLabel(accountId)}] Почти такой же ответ уже ушёл ${senderName} — дубль не шлю.`,
    );
    try {
      require('./opsLiveMetrics').bump('nearDupSkip');
    } catch (_) {}
    return;
  }
  try {
    const om = require('./opsLiveMetrics');
    om.bump('replies');
    om.noteReply(accountId, outText);
  } catch (_) {}
  const parsed = parseReplyBubbles(outText);
  const bubbles = parsed
    .map((b) => ({
      ...b,
      text: sanitizeOutgoingText(stripQuestionTags(b.text)),
    }))
    .filter((b) => b.text);
  if (!bubbles.length) return;
  outText = bubbles.map((b) => b.text).join('\n');
  lastOutboundByPeer.set(bufferKey(accountId, peerId), { text: outText, at: Date.now() });
  // Запоминаем, что рассказала о себе — для следующих ответов этому человеку.
  memoryTriggers.extractSelfTold(accountId, peerId, outText).catch(() => {});
  if (bubbles.length > 1) {
    const replyTargets = await resolveReplyTargets(client, sender, parsed, incomingText);
    for (let i = 0; i < bubbles.length; i++) {
      if (i > 0) {
        // Между пузырями — дописывает мысль: typing по длине следующего куска.
        const gapMs = Math.min(
          3200,
          Math.max(500, Math.round(computeTypingMs(bubbles[i].text) * 0.55)),
        );
        await waitBeforeReply(client, sender, gapMs, gapMs);
      }
      const opts = { message: bubbles[i].text };
      if (replyTargets[i]) opts.replyTo = replyTargets[i];
      await tgSendMessage(client, sender, opts);
      await saveMessage(accountId, peerId, senderName, 'assistant', bubbles[i].text);
    }
    return;
  }
  const pair = maybeTypoPair(outText);
  if (!pair) {
    await tgSendMessage(client, sender, { message: outText });
    await saveMessage(accountId, peerId, senderName, 'assistant', outText);
    return;
  }
  await tgSendMessage(client, sender, { message: pair.wrong });
  await saveMessage(accountId, peerId, senderName, 'assistant', pair.wrong);
  await sleep(700 + Math.random() * 1400);
  try {
    await client.invoke(
      new Api.messages.SetTyping({
        peer: sender,
        action: new Api.SendMessageTypingAction(),
      }),
    );
  } catch (_) {}
  await sleep(900 + Math.random() * 1600);
  await tgSendMessage(client, sender, { message: pair.fix });
  await saveMessage(accountId, peerId, senderName, 'assistant', pair.fix);
  console.log(
    `[${accountLabel(accountId)}] Опечатка→правка для ${senderName}: "${pair.wrong}" → "${pair.fix}"`,
  );
}


async function processBufferedMessages(
  accountId,
  sender,
  message,
  peerId,
  senderName,
  text,
) {
  // Защита от дублей (см. комментарий у объявления processingInFlight выше):
  // если этот диалог УЖЕ обрабатывается (например, живой обработчик уже
  // внутри своей человеческой пау��ы перед ��тветом), второй параллельный
  // вызов (из скана непрочитанных или рассылки приветствий) пропускаем,
  // а не запускаем вторую генерацию ответа на то же сообщение.
  if (isNeverContact(sender) || isNeverContact(senderName)) return;
  const inFlightKey = bufferKey(accountId, peerId);
  const msgId = message?.id != null ? Number(message.id) : null;
  // #14: он написал сам — отменяем «вернусь позже».
  try {
    humanHardening.cancelDeferredText(accountId, peerId);
  } catch (_) {
    /* optional */
  }

  if (processingInFlight.has(inFlightKey)) {
    // Не дропаем текст: после текущего ответа ответим одним разом на накопившееся.
    const pending = pendingAfterInFlight.get(inFlightKey) || {
      texts: [],
      sender,
      message,
      senderName,
    };
    if (text && !pending.texts.includes(text)) pending.texts.push(text);
    pending.sender = sender;
    pending.message = message;
    pending.senderName = senderName;
    pendingAfterInFlight.set(inFlightKey, pending);
    console.log(
      `[${accountLabel(accountId)}] ${senderName} уже обрабатывается — коплю сообщение, отвечу одним разом после текущего.`,
    );
    return;
  }

  const answeredBefore = lastAnsweredMsgId.get(inFlightKey);
  if (msgId && answeredBefore != null && answeredBefore >= msgId) {
    console.log(
      `[${accountLabel(accountId)}] ${senderName}: сообщение #${msgId} уже отвечено — дубль пропускаю.`,
    );
    return;
  }

  processingInFlight.add(inFlightKey);

  const lastReply = lastReplyAt.get(inFlightKey) || 0;
  if (Date.now() - lastReply < MIN_REPLY_GAP_MS) {
    processingInFlight.delete(inFlightKey);
    // Скан это сообщение уже не подхватит: последним в диалоге стоит наш ответ
    // (message.out), хотя вопрос пришёл раньше него. Поэтому переносим, а не дропаем.
    const waitMs = MIN_REPLY_GAP_MS - (Date.now() - lastReply) + 400 + Math.floor(Math.random() * 1200);
    scheduleGapRetry(accountId, sender, message, peerId, senderName, text, waitMs);
    console.log(
      `[${accountLabel(accountId)}] Слишком скоро после предыдущего ответа — отвечу ${senderName} через ${Math.round(waitMs / 1000)}с.`,
    );
    return;
  }

  const waitingGap = gapRetries.get(inFlightKey);
  if (waitingGap) {
    clearTimeout(waitingGap.timer);
    gapRetries.delete(inFlightKey);
    const extra = waitingGap.texts.filter((t) => t && !String(text).includes(t));
    if (extra.length) text = [...extra, text].join('\n');
  }

  let workMentionClaimed = false;
  let voiceDialogKey = null;
  try {
    // Проверяем настройки аккаунта: автоответчик должен быть включён.
    const settings = await getAccountSettings(accountId);
    if (!settings || !settings.is_autoreply_enabled) {
      console.log(
        `[${accountLabel(accountId)}] Сообщение от ${senderName} получено, но ав��оответчик выключен.`,
      );
      return;
    }

    if (await isPeerBlacklisted(accountId, peerId)) {
      console.log(`[${accountLabel(accountId)}] ${senderName} в blacklist — не отвечаю.`);
      return;
    }
    // Если этому собеседнику ранее ушло голосовое с просьбой о помощи — проверяем
    // согласие ДО отключения автоответа. Голосовые собеседника уже расшифрованы
    // в текст на этапе extractIncomingText, так что распознаётся и голосовой,
    // и текстовый ответ. Проверяем всегда, даже если автоответ уже отключён —
    // иначе после первого отключения согласие на дальнейшие сообщения перестало
    // бы детектироваться вовсе.
    await helpRequestNotifier.checkConsent(accountId, peerId, senderName, settings.phone, text, accountLabel(accountId));

    // После отправки голосового с просьбой о помощи автоответ для этого
    // конкретного собеседника отключён �� дальше в��дёт оператор вручную.
    if (await helpRequestNotifier.isAutoreplyDisabledForPeer(accountId, peerId)) {
      console.log(
        `[${accountLabel(accountId)}] Автоответ отключён для ${senderName} (пауза после предложки) — пропускаю.`,
      );
      return;
    }

    // Клиент должен быть активен, чтобы отправить ответ.
    const client = getActiveClient(accountId);
    if (!client) return;

    // Фильтр 4: игнорируем собеседников, спрятанных в АРХИВ.
    // getInputSender() иногда null — тогда проверяем по sender entity.
    let archiveCheckPeer = sender;
    try {
      const inputPeer = await message.getInputSender();
      if (inputPeer) archiveCheckPeer = inputPeer;
    } catch (_) {}
    if (await isPeerArchived(client, archiveCheckPeer || sender || peerId)) {
      console.log(
        `[${accountLabel(accountId)}] Сообщение от ${senderName} получено, но диалог в архиве — не читаю и не отвечаю.`,
      );
      return;
    }

    // 01–08 МСК: текст тоже молчит (как глубокий сон).
    if (isNightTextQuietHour()) {
      console.log(
        `[${accountLabel(accountId)}] Сообщение от ${senderName} в ночной тишине (01–08 МСК) — отвечу утром.`,
      );
      return;
    }
    // Фильтр 5: режим дня. Вне бодрствования НЕ отвечаем —
    // ИСКЛЮЧЕНИЕ: явная просьба медиа (видео/лайф/фото) — иначе долг висит до утра.
    const mediaWhileSleep = isHardMediaRequest(text);
    if (!isWithinWorkingHours(accountId) && !mediaWhileSleep) {
      const life = ensureDailyLife(accountId);
      console.log(
        `[${accountLabel(accountId)}] Сообщение от ${senderName} получено во сне ` +
          `(режим ${formatClock(life.wakeMin)}–${formatClock(life.sleepMin)}) — отвечу после подъёма.`,
      );
      return;
    }
    if (!isWithinWorkingHours(accountId) && mediaWhileSleep) {
      console.log(
        `[${accountLabel(accountId)}] ${senderName}: медиа-просьба во сне — всё равно отвечаю (долг).`,
      );
    }

    let contextualText = text;
    try {
      const repliedMessage =
        typeof message.getReplyMessage === 'function'
          ? await message.getReplyMessage()
          : null;
      const repliedText = repliedMessage
        ? String(repliedMessage.message || repliedMessage.text || '').trim()
        : '';
      if (repliedText) {
        // out=true → он ответил на НАШУ фразу (уточнение смысла).
        // out=false → ответил на своё же / чужое — цитата собеседника.
        // extractIncomingText уже мог повесить [ответ на …] — снимаем и ставим один ярлык.
        const bare = stripQuoteMarkers(text);
        const quote = repliedText.slice(0, 180).replace(/\s+/g, ' ');
        const isOurs = Boolean(repliedMessage.out);
        contextualText = isOurs
          ? `[уточнение к твоей фразе «${quote}»]: ${bare}`
          : `[ответ на его сообщение «${quote}»]: ${bare}`;
      }
    } catch (error) {
      console.warn(
        `[${accountLabel(accountId)}] Не удалось получить цитируемое сообщение:`,
        error.message,
      );
    }

    // Дальше в��е классификаторы и AI используют сообщение вместе с цитатой.
    text = contextualText;
    console.log(`[${accountLabel(accountId)}] ${senderName}: "${text}"`);

    // 1. Берём историю диалога (до текущего сообщения).
    const history = await getHistory(accountId, peerId);

    // После нашего «спокойной» вечером/ночью — молчим до утра (кроме hard media).
    try {
      const i14 = require('./humanIdeas14');
      if (
        i14.shouldSkipUntilMorning(history, contextualText || text, {
          hardMedia: isHardMediaRequest(contextualText || text, history),
        })
      ) {
        console.log(
          `[${accountLabel(accountId)}] ${senderName}: после спокойной — тишина до утра.`,
        );
        await saveMessage(accountId, peerId, senderName, 'user', contextualText);
        return;
      }
    } catch (_) {
      /* optional */
    }

    // 2. Сохраняем входящее сообщение собеседника.
    await saveMessage(accountId, peerId, senderName, 'user', contextualText);

    // 2.5. Если человек написал во время паузы занятости, отменяем старый
    // таймер. Больше не отправляем запланированный вопрос вроде «что делаешь?»:
    // после небольшой естественной задержки отвечаем на актуальное сообщение.
    let forcedDelayMs = null;
    const deferredNow = deferredDialogs.get(bufferKey(accountId, peerId));
    if (deferredNow) {
      clearTimeout(deferredNow.timer);
      deferredDialogs.delete(bufferKey(accountId, peerId));
      forcedDelayMs = DEFER_INTERRUPT_DELAY_MS;
      console.log(
        `[${accountLabel(accountId)}] ${senderName} написал во время паузы — отменяю свой вопрос, отвечу через ~${Math.round(DEFER_INTERRUPT_DELAY_MS / 1000)}с.`,
      );
    }

    if (isAnswerToHowLong(history)) {
      const stayDays = parseStayDays(text);
      console.log(
        `[${accountLabel(accountId)}] ${senderName} ответил, сколько на дв: "${String(text).slice(0, 80)}" → ${stayDays ?? '?'} дн.`,
      );
      if (stayDays != null && stayDays >= HOWLONG_ARCHIVE_DAYS) {
        // Архив + воронка «отсев». Autoreply off (reason=filtered), без TG-mute:
        // при новом сообщении чат может вылезти из архива, но AI не отвечает.
        await markPeerAsRead(client, sender, message);
        try {
          const leadScoring = require('./leadScoring');
          {
            const { formatFilterNote } = require('./opsQuality');
            await leadScoring.markPeerFiltered(
              accountId,
              peerId,
              formatFilterNote('howlong', `${stayDays} дн. (≥${HOWLONG_ARCHIVE_DAYS})`),
            );
          }
        } catch (e) {
          console.error(
            `[${accountLabel(accountId)}] Не удалось пометить отсев ${senderName}:`,
            e.message,
          );
        }
        try {
          await archivePeer(client, sender);
        } catch (e) {
          console.error(
            `[${accountLabel(accountId)}] Не удалось архивировать ${senderName}:`,
            e.errorMessage || e.message,
          );
        }
        console.log(
          `[${accountLabel(accountId)}] ${senderName} на дв ${stayDays} дн. (≥${HOWLONG_ARCHIVE_DAYS}) — отсев + архив (без mute).`,
        );
        return;
      }
    }

    // Явная просьба прислать медиа определяется заранее — она нужна и для
    // приоритета над голосовыми, и для медиа-логики ниже.
    // Тематические вопросы («ты высокая?») тоже считаются, если только что
    // не отправили медиа (чтобы не спамить фото на каждый follow-up).
    const mediaLinkEarly =
      typeof settings.media_chat_link === 'string'
        ? settings.media_chat_link.trim()
        : '';
    const sexualPressure = objectionHandler.isSexualPressure(contextualText);
    const topicPhoto =
      !sexualPressure &&
      !!mediaLinkEarly &&
      isTopicPhotoRequest(contextualText) &&
      !lastAssistantWasMedia(history);
    const hardMediaRequest = !sexualPressure && isHardMediaRequest(contextualText, history);
    const explicitMediaRequest = hardMediaRequest || topicPhoto;

    // 3. Проверяем голосовые заготовки по ВХОДЯЩЕМУ сообщению.
    // voice.voiceOnly === true  -> отправляем ТОЛЬКО голосовое, без AI-текста.
    // voice.voiceOnly === false -> AI ответит текстом, а голосовое уйдёт следом.
    // Каждую заготовку шлём собеседнику лишь один раз: если она уже
    // отправлялась (метка есть в истории) — второй раз не дублируем.
    //
    // ВАРИАНТ Б: если человек ЯВНО просит фото/видео/кружок, а у аккаунта
    // задан медиа-чат — голосовые заготовки НЕ перехватывают запрос. Иначе
    // «запиши кружок, что делаешь» ловилось бы триггером «что делаешь» и
    // уходило голосовое вместо кружка.
    let voice =
      explicitMediaRequest && mediaLinkEarly
        ? null
        : findVoiceForText(contextualText || text);
    if (voice && voiceForbiddenPeers.has(inFlightKey)) voice = null;
    if (voice && humanHardening.isCloneSkeptic(text)) voice = null;

    // Глубокой ночью (01:00–08:00 по МСК) голосовые заготовки не шлём:
    // человек уже лёг спать, а голосовое в 01:30 выглядит жутко.
    if (voice && isVoiceQuietHour()) {
      console.log(
        `[${accountLabel(accountId)}] Тихие часы — голосовую заготовку для ${senderName} не отправляю.`,
      );
      voice = null;
    }

    // Если собеседник только что попрощался / сказал что засыпает —
    // никаких голосовых и кружков, только короткий текст (или тишина).
    if (voice) {
      const lastIn = await lastIncomingText(accountId, peerId);
      if (lastIn && looksLikeFarewell(lastIn)) {
        console.log(
          `[${accountLabel(accountId)}] ${senderName} попрощался — голосовую заготовку не отправляю.`,
        );
        voice = null;
      }
    }

    // Не шлём голосовое, если предыдущее (любое, включая «как проходит день»)
    // ушло меньше часа назад — иначе два голосовых подряд.
    if (voice) {
      const lastVoiceAt = await lastAnyVoiceSentAt(accountId, peerId);
      if (lastVoiceAt && Date.now() - lastVoiceAt < VOICE_REPEAT_GAP_MS) {
        console.log(
          `[${accountLabel(accountId)}] Недавно уже было голосовое — заготовку для ${senderName} пропускаю.`,
        );
        voice = null;
      }
    }

    // Голосовые файлы на русском — англоязычным / не-RU собеседникам не шлём.
    const allowVoice = isRussianConversation(contextualText || text, history);
    if (voice && !allowVoice) {
      console.log(
        `[${accountLabel(accountId)}] ${senderName} пишет не по-русски — голосовые заготовки пропускаю.`,
      );
      voice = null;
    }

    voiceDialogKey = voice ? `${accountId}:${String(peerId)}` : null;
    // Повтор — только ЭТОЙ же заготовки (не «любое голосовое когда-либо»).
    // Иначе после приветственного ГС навсегда глушился «береги себя» на СВО,
    // и модель отвечала текстом «это в IT».
    if (
      voice &&
      (voiceSendInFlight.has(voiceDialogKey) ||
        (await wasVoiceSent(accountId, peerId, voice.fileName)))
    ) {
      console.log(
        `[${accountLabel(accountId)}] Заготовка «${voice.fileName}» уже уходила ${senderName} — повторно не отправляю.`,
      );
      // Раньше на voiceOnly-правиле здесь стоял return — и бот молчал совсем:
      // голосовое пропускал, а текст не генерировал (человек оставался без
      // ответа). Теперь в любом случае продолжаем обычный AI-ответ текстом,
      // просто уже без голосового.
      voice = null;
    } else if (voiceDialogKey) {
      // Резервируем диалог до фактической отправки: задержка ответа может быть
      // длинной, и второе входящее сообщение иначе успеет пройти ту же проверку.
      voiceSendInFlight.add(voiceDialogKey);
    }

    // Снимаем резерв, если голосовое в итоге не уйдёт (sleep / fixed / ошибка / только текст).
    const releaseVoiceSlot = () => {
      if (voiceDialogKey) {
        voiceSendInFlight.delete(voiceDialogKey);
        voiceDialogKey = null;
      }
    };

    // Случайная задержка перед ответом (диапазон задаётся в настройках).
    // Если бот «отвлёкся» во время паузы — используем короткую задержку ~2 мин.
    const delayMs =
      forcedDelayMs != null ? forcedDelayMs : pickReplyDelayMs(settings);

    if (voice && voice.voiceOnly) {
      console.log(
        `[Аккаунт ${accountId}] Пауза ${Math.round(delayMs / 1000)}с перед голосовым для ${senderName}.`,
      );
      await humanPauseBeforeSend(
        client,
        sender,
        message,
        delayMs,
        Math.min(4200, Math.max(1600, delayMs * 0.55)),
        text,
      );
      if (await abortIfPausedOrBlacklisted(accountId, peerId, senderName, 'после паузы (voice)')) {
        return;
      }
      try {
        humanHardening.logOutboundReason(accountId, accountLabel(accountId), 'voice', {
          peer: senderName,
          file: voice.fileName,
          voiceOnly: voice.voiceOnly ? 1 : 0,
          hostile: humanHardening.isCloneSkeptic(text) ? 1 : 0,
        });
        await sendVoiceReply(client, sender, voice.filePath);
      } catch (err) {
        if (!isVoiceForbiddenError(err)) throw err;
        voiceForbiddenPeers.add(inFlightKey);
        releaseVoiceSlot();
        console.log(`[${accountLabel(accountId)}] ${senderName} запретил голосовые — отвечаю текстом.`);
        voice = null;
      }
    }
    // После voiceOnly+alsoText не брать fixed-text по тому же триггеру
    // («я на сво» → ГС, потом снова «береги себя)» вместо ответа на «где ты?»).
    let skipFixedText = false;
    if (voice && voice.voiceOnly) {
      await saveMessage(
        accountId,
        peerId,
        senderName,
        'assistant',
        voiceTag(voice.fileName),
      );
      lastReplyAt.set(inFlightKey, Date.now());
      // Буфер с несколькими смыслами («спокойной ночи» + «где ты?») —
      // ГС ушло, но текст по остальному ещё нужен.
      const lines = String(text || '')
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      // Не сырой /?/ — риторический «?))» и шум Whisper иначе всегда тянут AI.
      const alsoText =
        lines.length > 1 || extractUserQuestions(text).length > 0;
      if (!alsoText) {
        if (msgId) lastAnsweredMsgId.set(inFlightKey, msgId);
        releaseVoiceSlot();
        console.log(
          `[${accountLabel(accountId)}] Отправлено только голосовое (без текста) для ${senderName}.`,
        );
        return;
      }
      releaseVoiceSlot();
      voice = null;
      skipFixedText = true;
      console.log(
        `[${accountLabel(accountId)}] Голосовое ушло ${senderName}, ещё текст по остальному в буфере.`,
      );
    }

    // 3.5. Фиксированные текстовые ответы по триггеру (без обращения к AI).
    // Например, на «что ищешь здесь?» отвечаем заранее заданным текстом.
    // Если в буфере ещё вопрос («я на сво, а где ты?») — не глушим AI fixed-ом.
    let fixedReply = skipFixedText ? null : findTextReplyForText(text);
    if (fixedReply) {
      const fixedLines = String(text || '')
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const fixedHasExtra =
        fixedLines.length > 1 ||
        extractUserQuestions(text).length > 0 ||
        /[?]/.test(text);
      if (fixedHasExtra) {
        console.log(
          `[${accountLabel(accountId)}] Fixed «${fixedReply}» пропущен — в буфере ещё смысл, ответит AI.`,
        );
        fixedReply = null;
      }
    }
    if (fixedReply) {
      releaseVoiceSlot();
      const textDelayMs = forcedDelayMs != null ? forcedDelayMs : delayBeforeSendMs(settings, fixedReply);
      console.log(
        `[${accountLabel(accountId)}] Пауза ${Math.round(textDelayMs / 1000)}с перед фиксированным ответом для ${senderName}.`,
      );
      await humanPauseBeforeSend(
        client,
        sender,
        message,
        textDelayMs,
        Math.min(computeTypingMs(fixedReply), textDelayMs),
        text,
      );
      if (await abortIfPausedOrBlacklisted(accountId, peerId, senderName, 'после паузы (fixed)')) {
        return;
      }
      if (await cancelReplyIfDialogGone(client, accountId, sender, senderName, message, 'fixed')) {
        return;
      }
      await tgSendMessage(client, sender, { message: fixedReply });
      lastReplyAt.set(bufferKey(accountId, peerId), Date.now());
      if (msgId) lastAnsweredMsgId.set(inFlightKey, msgId);
      await saveMessage(accountId, peerId, senderName, 'assistant', fixedReply);
      console.log(
        `[${accountLabel(accountId)}] Фиксированный ответ для ${senderName}: "${fixedReply}"`,
      );
      return;
    }

    // 3.7. «Живой» игнор: иногда (редко) вместо обычного ответа бот ведёт
    // себя как занятой человек — молчит, а через 5–25 мин сам ответит
    // по существу. Не срабатывает: на явную просьбу медиа, на голосовые
    // заготовки, при вынужденном ответе (человек написал во время паузы) и в
    // самом начале знакомства (пока история короткая).
    // Пока «занята» — сообщение остаётся непрочитанным (галочки только
    // когда реально отвечаем).
    const flipPhotoQuestion = await objectionHandler.shouldForceReplyForFlipPhoto(
      text,
      history,
      accountId,
      peerId,
    );
    if (
      forcedDelayMs == null &&
      !explicitMediaRequest &&
      unfulfilledMediaPromiseCount(history) === 0 &&
      !voice &&
      !flipPhotoQuestion &&
      history.length >= DEFER_MIN_HISTORY &&
      Math.random() < DEFER_CHANCE
    ) {
      // #4: на hard-нагрузке не уходим в длинную «занята» — отвечаем с паузой.
      // #5: при долге медиа «Занята» не ставим — иначе обещание сгорает.
      let skipBusy = false;
      try {
        const th = await require('./scaleOps').loadThrottleState(accountId);
        if (th.level === 'hard') skipBusy = true;
      } catch (_) {}
      if (!skipBusy) {
        scheduleReengage(accountId, sender, peerId, senderName, history, text, message, {
          explicitMedia: false,
        });
        return;
      }
    }

    // Читаем диалог только непосредственно перед отправкой ответа
    // (см. ниже) — если ИИ не ответил / sleep / ошибка, галочек не ставим.

    // Медиа: явная просьба — всегда; иначе редко кружок по смыслу диалога.
    const mediaLink = mediaLinkEarly;
    const mediaEnabled = !!mediaLink && explicitMediaRequest;
    // NFT/темп: leadTier раньше медиа — cold реже шлёт кружок сам.
    const leadSnap = await leadScoring.getPeerScoreSnapshot(accountId, peerId);
    const opsQ = require('./opsQuality');
    let contextualCircle =
      !!mediaLink && !explicitMediaRequest && (await canSendContextualCircle(accountId, peerId, history));
    if (contextualCircle && !opsQ.allowProactiveMedia(leadSnap?.tier, false)) {
      contextualCircle = false;
    }
    // Собеседник явно просит фото/видео/кружок, но у аккаунта НЕ привязан
    // медиа-чат — реального медиа для отправки нет вообще. Без этой подсказки
    // модель раз за разом стелется вежливыми «щас поищу», «щас подожди»,
    // «выбираю» — это выглядит подозрительно при повторных просьбах (см.
    // жалобу собеседника «третий раз уже это пишешь»). Вместо стилки просим
    // модель сразу дать твёрдую бытовую отговорку.
    const noMediaExcuse = explicitMediaRequest && !mediaLink;

    // NFT-кампания: 1–2 день — мягкое упоминание темы, 3-й день — голосовое.
    // leadTier (cold/warm/hot) сдвигает пороги — не пихаем NFT холодным рано.
    const nft = await getNftCampaignState(accountId, peerId, history.length, {
      leadTier: leadSnap?.tier,
    });
    const suppressNft = await shouldSuppressNftForTurn(text, {
      flipPhotoQuestion,
      explicitMediaRequest,
      history,
      accountId,
      peerId,
    });
    if (suppressNft) {
      nft.hint = null;
      nft.sendVoice = false;
      nft.sayWorkProblem = false;
    }
    if (!allowVoice && nft.sendVoice) {
      console.log(
        `[${accountLabel(accountId)}] ${senderName} не на русском — NFT-голосовое пропускаю.`,
      );
      nft.sendVoice = false;
    }

    // Если этому собеседнику ранее ушло голосовое с просьбой о помощи — проверяем,
    // не согласился ли он именно этим сообщением (см. helpRequestNotifier.js).
    await helpRequestNotifier.checkConsent(accountId, peerId, senderName, settings.phone, text, accountLabel(accountId));

    // Динамический тайм-менеджмент + Mood Engine + Memory Triggers +
    // обработка возражений/анти-детект — см. соответствующие модули.
    const timeInfo = getAccountTimeStyle(accountId);
    if (timeInfo.isSleep && !isHardMediaRequest(contextualText || text)) {
      console.log(`[${accountLabel(accountId)}] Спит по режиму дня — пропускаем ответ ${senderName}`);
      return;
    }
    const moodInfo = await moodEngine.getConversationMood(accountId, peerId, contextualText);
    const accountMood = await moodEngine.getMood(accountId);
    const personaHint = await accountPersona.buildPersonaHint(accountId);
    const slangHint = humanExtra.slangHintForAccount(accountId);
    const dueMemory = await memoryTriggers.getDueFollowUp(accountId, peerId);
    const msgDate =
      message?.date != null
        ? new Date(Number(message.date) * (Number(message.date) < 1e12 ? 1000 : 1))
        : null;
    let mediaDebt = unfulfilledMediaPromiseCount(history) > 0;
    if (!mediaDebt && humanHardening.peekDueDeferredMedia(accountId, peerId)) {
      mediaDebt = true;
      humanHardening.takeDueDeferredMedia(accountId, peerId);
    }
    let morningHint = humanExtra.needsMorningApology(msgDate)
      ? humanExtra.morningApologyHint()
      : null;
    if (mediaDebt && (morningHint || isHardMediaRequest(contextualText, history))) {
      const debtLine =
        'Ты обещала прислать что-то милое/фото и ещё НЕ прислала. Сейчас ДОЛЖНА выполнить: ' +
        'короткий текст + токен <<PHOTO>>. Без нового «щас скину/попозже» и без голосового вместо фото.';
      morningHint = morningHint ? `${morningHint} ${debtLine}` : debtLine;
    }
    const awayMin = await humanExtra.lastAssistantAgeMinutes(accountId, peerId);
    const awayHint = morningHint ? null : humanExtra.awayReturnHint(awayMin);
    let detailHint = humanExtra.buildHisDetailCallbackHint(history, contextualText || text);
    {
      const evening = await require('./replyPipelineShared').buildEveningRecallHintSafe(
        accountId,
        peerId,
      );
      if (evening) detailHint = detailHint ? `${detailHint}\n${evening}` : evening;
    }
    const dialogAgeHours = await getDialogAgeHours(accountId, peerId);
    // How-long ack важнее generic later/dont_understand — иначе «потом» съедает реакцию на дв.
    let objectionHint = null;
    let ownAvatarHit = false;
    try {
      ownAvatarHit = require('./avatarMatch').messageHasOwnAvatarTag(contextualText || text);
    } catch (_) {}
    if (ownAvatarHit && typeof objectionHandler.getOwnAvatarClaimHint === 'function') {
      objectionHint = objectionHandler.getOwnAvatarClaimHint();
    } else if (flipPhotoQuestion) {
      objectionHint = objectionHandler.getFlipPhotoQuestionHint();
    } else if (isAnswerToHowLong(history)) {
      objectionHint = objectionHandler.getHowLongAckHint(text);
    } else {
      objectionHint = objectionHandler.detectHint(text, history, {
        voiceWillSend: !!voice,
        systemPrompt: settings.prompt,
        dialogAgeHours,
      });
    }
    {
      const hhExtra = humanHardening.buildHardeningHints(contextualText || text, history, {
        accountId,
        peerId,
        skipClone: true,
        systemPrompt: settings.prompt,
      });
      if (hhExtra) {
        objectionHint = objectionHint ? `${objectionHint}\n${hhExtra}` : hhExtra;
      }
      const burst = humanHardening.getBurstReplyHint(contextualText || text);
      if (burst) {
        objectionHint = objectionHint ? `${objectionHint}\n${burst}` : burst;
      }
      try {
        const leads = require('./humanRhythm').whoLeadsHint(history, contextualText || text);
        if (leads) {
          objectionHint = objectionHint ? `${objectionHint}\n${leads}` : leads;
        }
      } catch (_) {
        /* optional */
      }
    }
    let peerFactsForForget = [];
    try {
      peerFactsForForget = await memoryTriggers.listPeerFacts(accountId, peerId);
      const forgetH = require('./humanRhythm').honestForgetHint(
        contextualText || text,
        peerFactsForForget,
      );
      if (forgetH) {
        objectionHint = objectionHint ? `${objectionHint}\n${forgetH}` : forgetH;
      }
    } catch (_) {
      peerFactsForForget = [];
    }
    const complimentHint = await complimentEngine.getComplimentHint(accountId, peerId, contextualText);
    const useMemoryHint =
      dueMemory?.hint && !objectionHandler.isDirectQuestion(text) ? dueMemory.hint : null;

    // Обучение на прошлом опыте: сначала оцениваем реакцию собеседника на
    // предыдущие ответы бота (окно из нескольких сообщений — см.
    // learningDb.js), затем достаём лучшие/худшие фразы ТОГО ЖЕ ЭТАПА
    // диалога для подмешивания в промпт текущего ответа.
    const learningStage = learningDb.detectStage({ objectionHint, nftHint: nft.hint, historyLength: history.length });
    await learningDb.scoreAndLearn(accountId, peerId, text);
    const ragDay = ragExamples.dialogDayFromAgeHours(dialogAgeHours);
    const ragHistoryHint = (Array.isArray(history) ? history : [])
      .filter((h) => h && h.role === 'user')
      .slice(-3)
      .map((h) => String(h.content || '').replace(/\[реакция:[^\]]*\]/gi, '').trim().slice(0, 120))
      .filter(Boolean)
      .join('\n');
    const [learningSnippet, manualSnippet, ragSnippet] = await Promise.all([
      learningDb.buildLearningSnippet(learningStage, { accountId, peerId }),
      learningDb.buildManualTrainingSnippet(accountId, text),
      ragExamples.buildRagSnippet(ragDay, contextualText || text, ragHistoryHint),
    ]);
    // Факт + стиль чата запоминаем «на будущее» (не блокирует ответ).
    memoryTriggers.extractAndSaveFact(accountId, peerId, text).catch(() => {});
    peerProfile.maybeUpdate(accountId, peerId, history).catch(() => {});

    const emotionHint = buildEmotionHint(history);
    // ВАЖНО: sessionForgetHint снаружи try — иначе после finally ReferenceError
    // «sessionForgetHint is not defined» (const жил только внутри try).
    const sessionForgetHint = buildSessionForgetHint(history.length <= 4);
    const memoryContextHint = sessionForgetHint
      ? null
      : await memoryTriggers.buildMemoryContextHint(accountId, peerId);
    const peerProfileHint = await peerProfile.buildHint(accountId, peerId);
    const externalFactHint = await externalFacts.buildExternalFactHint(
      settings.prompt,
      contextualText || text,
    );

    // Без typing во время AI: иначе «печатает» при непрочитанном — палево.
    let rawReply;
    if (!settings.prompt || !String(settings.prompt).trim()) {
      console.error(
        `[${accountLabel(accountId)}] Промпт пустой — AI не отвечаю (нужен промпт в кабинете).`,
      );
      return;
    }
    rawReply = await generateReply(settings.prompt, history, text, {
      mediaEnabled,
      contextualCircle,
      noMediaExcuse,
      topicPhoto,
      campaignHint: suppressNft || flipPhotoQuestion ? null : nft.hint,
      learningSnippet,
      manualSnippet,
      ragSnippet,
      timeHint: timeInfo.hint,
      moodHint: moodInfo.hint,
      accountMoodHint: accountMood.hint || null,
      flashEmotion: moodInfo.flash || null,
      personaHint,
      slangHint,
      emotionHint,
      sessionForgetHint,
      memoryContextHint,
      memoryHint: sessionForgetHint ? null : useMemoryHint,
      objectionHint,
      complimentHint,
      morningApologyHint: morningHint,
      awayReturnHint: awayHint,
      hisDetailHint: detailHint,
      peerProfileHint,
      externalFactHint,
      accountId,
      peerId,
      dialogAgeHours,
      voiceWillSend: !!voice,
      voiceFileName: voice?.fileName || null,
    });
    if (!rawReply) {
      console.error(
        `[${accountLabel(accountId)}] AI не дал ответ для ${senderName} — молчу (без soft-fill).`,
      );
      return;
    }
    rawReply = sanitizeReplyAgainstNftLeak(rawReply, objectionHint);
    try {
      rawReply = require('./humanRhythm').applyHonestForget(
        rawReply,
        contextualText || text,
        peerFactsForForget,
      );
    } catch (_) {
      /* optional */
    }
    {
      const nudeSrc = contextualText || text;
      if (sexualPressure || objectionHandler.isNudeAsk(nudeSrc)) {
        rawReply = objectionHandler.softenSexualPressureReply(rawReply, nudeSrc);
      }
      rawReply = objectionHandler.softenFakeAccusationReply(rawReply, nudeSrc);
      if (typeof objectionHandler.softenFraudAdmissionReply === 'function') {
        rawReply = objectionHandler.softenFraudAdmissionReply(rawReply, nudeSrc, history);
      }
      {
        let matchesOwnAvatar = false;
        try {
          const am = require('./avatarMatch');
          matchesOwnAvatar = am.messageHasOwnAvatarTag(nudeSrc);
        } catch (_) {}
        if (typeof objectionHandler.softenFlipPhotoIdentityReply === 'function') {
          rawReply = objectionHandler.softenFlipPhotoIdentityReply(
            rawReply,
            nudeSrc,
            history,
            { flipRecent: Boolean(flipPhotoQuestion), matchesOwnAvatar },
          );
        }
        if (typeof objectionHandler.softenClaimedHerPhotoReply === 'function') {
          rawReply = objectionHandler.softenClaimedHerPhotoReply(rawReply, nudeSrc, {
            matchesOwnAvatar,
          });
        }
      }
      rawReply = externalFacts.groundClockReply(
        rawReply,
        settings.prompt,
        nudeSrc,
      );
      if (humanHardening.detectDeferredMediaPromise(rawReply)) {
        const job = humanHardening.scheduleDeferredMedia(accountId, peerId, { kind: 'photo' });
        try {
          require('./inbound').scheduleDeferredMediaReturn(
            accountId,
            sender,
            peerId,
            senderName,
            job,
          );
        } catch (_) {
          /* optional */
        }
      }
    }
    // echoLength / antiMirror уже в finalize aiResponder — второй раз не режем.
    if (dueMemory && useMemoryHint && !sessionForgetHint) memoryTriggers.markFollowedUp(dueMemory.id).catch(() => {});

    // Отделяем текст от запрошенного типа медиа (токен вырезаем из текста).
    const { text: replyWithoutLaugh, laugh } = splitLaugh(rawReply);
    let { text: replyWithoutReact, reaction } = extractReaction(replyWithoutLaugh);
    {
      const gated = applyReactionGate(
        contextualText || text,
        reaction,
        replyWithoutReact,
        accountId,
        peerId,
      );
      if (reaction && !gated.reaction) {
        console.log(
          `[${accountLabel(accountId)}] Реакцию снял (вопрос/не эмоция) от ${senderName}.`,
        );
      }
      reaction = gated.reaction;
      replyWithoutReact = gated.outText;
    }
    try {
      if (require('./humanIdeas12').detectDeferredInterest(replyWithoutReact)) {
        humanHardening.scheduleDeferredText(accountId, peerId, {
          delayMs: 45 * 60 * 1000 + Math.floor(Math.random() * 3 * 3600 * 1000),
          reason: 'deferred_interest',
        });
      }
    } catch (_) {
      /* optional */
    }
    const {
      text: reply,
      mediaType: rawMediaType,
      fromLeak: mediaFromLeak,
    } = extractMediaRequest(replyWithoutReact);

    // Защита от «медиа два хода подряд»: если модель снова захотела прислать
    // медиа, но прошлый ответ уже был медиа И человек НЕ просил новое явно —
    // подавляем. Так на вопрос «а куда едешь на кружочке?» бот ответит
    // текстом, а не пришлёт ещё один кружок.
    let mediaType = rawMediaType;
    // Явная просьба + есть медиа-чат → всегда пытаемся отправить, даже если
    // модель забыла токен (раньше часть людей оставалась без фото).
    if (explicitMediaRequest && mediaLink && !mediaType) {
      mediaType = detectRequestedMediaType(contextualText);
    }
    if (sexualPressure && mediaType) {
      console.log(`[${accountLabel(accountId)}] Подавил медиа на секс-давление от ${senderName}.`);
      mediaType = null;
    }
    // Утечка «[фото билета]» / «[отправила фото]» — не глушим, шлём реальный файл.
    if (!explicitMediaRequest && !mediaFromLeak) {
      if (mediaType && mediaType !== 'circle') {
        if (rawMediaType === 'photo' || rawMediaType === 'video') {
          console.log(
            `[${accountLabel(accountId)}] Подавил незапрошенное ${rawMediaType} для ${senderName}.`,
          );
        }
        mediaType = null;
      }
      if (mediaType === 'circle' && !contextualCircle) mediaType = null;
    }
    if (mediaFromLeak && mediaType && mediaLink) {
      console.log(
        `[${accountLabel(accountId)}] Утечка псевдо-медиа → шлю реальный ${mediaType} для ${senderName}.`,
      );
    }
    if (mediaType && !explicitMediaRequest && !mediaFromLeak && lastAssistantWasMedia(history)) {
      console.log(
        `[${accountLabel(accountId)}] Подавил повторное медиа (${mediaType}) для ${senderName}: прошлый ответ уже был медиа, явной просьбы нет.`,
      );
      mediaType = null;
    }
    // Он сказал «это не сейчас / это старое» — новый готовый файл только
    // подтвердит архив. Отвечаем текстом, даже если он формально «просит фото».
    if (mediaType && peerComplainedMediaNotFresh(contextualText, history)) {
      console.log(
        `[${accountLabel(accountId)}] Подавил медиа (${mediaType}) для ${senderName}: он сомневается, что оно свежее.`,
      );
      mediaType = null;
    }
    // Он просит «докажи, что ты реальная». Готовый кружок из медиа-чата — не
    // доказательство: для него это чужой контент, который может быть у кого
    // угодно. Зато мгновенное видео после фейкового «я стесняюсь видео»
    // палит бота. Отвечаем текстом и уходим от темы.
    if (mediaType && peerAsksToProveHuman(contextualText)) {
      console.log(
        `[${accountLabel(accountId)}] Подавил медиа (${mediaType}) для ${senderName}: он требует доказать, что я реальная.`,
      );
      mediaType = null;
    }
    // Бот только что отказалась от видео («я стесняюсь видео»), а он дожимает.
    // Послушать буквально и прислать кружок = показать, что отказ был фейковый.
    if (mediaType && botRecentlyRefusedVideo(history) && (await mediaRefusalQuietNow(accountId, peerId))) {
      console.log(
        `[${accountLabel(accountId)}] Подавил медиа (${mediaType}) для ${senderName}: только что отказалась от видео, рано присылать.`,
      );
      mediaType = null;
    }
    // Must #55: не слать медиа сразу после питча/профит-скрина.
    if (
      mediaType &&
      !explicitMediaRequest &&
      !mediaFromLeak &&
      (await humanHardening.shouldBlockMediaAfterPitchAsync(accountId, peerId))
    ) {
      console.log(
        `[${accountLabel(accountId)}] skip reason=media_after_pitch peer=${senderName} type=${mediaType}`,
      );
      mediaType = null;
    }
    try {
      const i14 = require('./humanIdeas14');
      if (mediaType && i14.shouldBlockMediaAfterNoShow(history)) {
        console.log(
          `[${accountLabel(accountId)}] skip reason=media_after_noshow peer=${senderName} type=${mediaType}`,
        );
        mediaType = null;
      }
    } catch (_) {
      /* optional */
    }

    // 6. Готовим текстовый ответ (если он есть — модель могла прислать
    // только токен без текста). Крайний случай: медиа подавили (см. выше), а
    // текста модель не дала — тогда шлём короткую нейтральную фразу, чтобы
    // не промолчать на вопрос.
    let outText = reply;
    if (!outText && rawMediaType && !mediaType && !reaction) {
      const fillers = ['да по делам)', 'та так, по своим)', 'ничего особенного)', 'да ничё такого)'];
      outText = fillers[Math.floor(Math.random() * fillers.length)];
    }
    // Nice #20/#7: на короткое «ок/ага» чаще реакция без текста.
    if (
      !mediaType &&
      !nft.sendVoice &&
      !voice &&
      humanHardening.preferReactionOnlyOnBareOk(contextualText || text, outText, {
        leadTier: leadSnap?.tier,
      })
    ) {
      if (!reaction) reaction = ['👍', '👌', '🥰'][Math.floor(Math.random() * 3)];
      outText = '';
    }
    if (
      mediaLink &&
      !mediaType &&
      (explicitMediaRequest || unfulfilledMediaPromiseCount(history) > 0) &&
      BARE_MEDIA_FILLER_RE.test(String(outText || '').trim())
    ) {
      mediaType = 'photo';
      outText = '';
      console.log(
        `[${accountLabel(accountId)}] Филлер вместо медиа → шлю photo для ${senderName}.`,
      );
    }

    if (mediaType && (mediaEnabled || mediaFromLeak)) {
      const mediaHelpers = require('./mediaSend');
      if (mediaHelpers.isContradictoryMediaText(outText)) {
        console.log(
          `[${accountLabel(accountId)}] Убрал отказной текст перед медиа для ${senderName}: "${outText}"`,
        );
        outText = mediaHelpers.stripContradictoryMediaParts(outText);
      }
    }
    let forcedMediaThisTurn = false;
    {
      const resolved = resolveMediaPromise(
        outText,
        mediaType && mediaLink ? mediaType : null,
        contextualText,
        history,
        !!mediaLink,
      );
      if (resolved.packedThings) {
        mediaType = null;
        forcedMediaThisTurn = false;
        outText = resolved.outText;
        console.log(
          `[${accountLabel(accountId)}] Вещи/коробки — без фото для ${senderName}: "${outText}"`,
        );
      } else if (resolved.forceMedia && mediaLink) {
        mediaType = mediaType || (resolved.preferPhoto ? 'photo' : detectRequestedMediaType(contextualText));
        if (resolved.preferPhoto) mediaType = 'photo';
        forcedMediaThisTurn = true;
        console.log(
          `[${accountLabel(accountId)}] Обещание медиа → отправляю ${mediaType} для ${senderName}` +
            (resolved.outText !== outText ? `: "${outText}" → "${resolved.outText || '(без текста)'}"` : ''),
        );
        outText = resolved.outText;
      } else if (resolved.outText !== outText) {
        console.log(
          `[${accountLabel(accountId)}] Обещание медиа без отправки для ${senderName}: "${outText}" → "${resolved.outText}"`,
        );
        outText = resolved.outText;
      }
    }
    try {
      const ms = require('./mediaSend');
      const askText = contextualText || text;
      if (mediaType && ms.isPackedThingsPhotoAsk(askText, history)) {
        console.log(
          `[${accountLabel(accountId)}] skip reason=packed_things_unavailable peer=${senderName}`,
        );
        mediaType = null;
        forcedMediaThisTurn = false;
        if (!outText || isMediaPromiseText(outText) || /найду\s+(?:нормальн\w*\s+)?фото/i.test(outText)) {
          outText = ms.pickPackedThingsExcuse();
        }
      }
    } catch (_) {
      /* optional */
    }
    if (mediaType && mediaLink) {
      const beforeAck = outText;
      outText = ensureMediaAckText(outText, mediaType);
      if (beforeAck !== outText) {
        console.log(
          `[${accountLabel(accountId)}] Медиа-ack вместо отказа для ${senderName}: "${beforeAck || ''}" → "${outText}"`,
        );
      }
    }

    // Не слать «щас по работе» поверх «щас скину милое» / фото.
    const pendingWorkAside =
      !!nft.sayWorkProblem &&
      !mediaType &&
      !forcedMediaThisTurn &&
      !explicitMediaRequest &&
      !voice &&
      !isMediaPromiseText(outText);
    if (mediaType || forcedMediaThisTurn || explicitMediaRequest) {
      nft.sendVoice = false;
      voice = null;
    }

    const reactionOnly = !!reaction && !outText && !mediaType && !voice && !nft.sendVoice;
    let lateTextMs = humanExtra.reactThenTextDelayMs(accountId, reaction, outText);
    try {
      lateTextMs = require('./humanRhythm').boostReactThenTextMs(
        lateTextMs,
        contextualText || text,
        reaction,
        outText,
      );
    } catch (_) {
      /* optional */
    }

    // 5. Пауза: реакция отдельно → (опц.) текст позже; иначе обычный typing.
    if (reactionOnly || (reaction && lateTextMs > 0)) {
      await markPeerAsRead(client, sender, message);
      const reactDelay = 700 + Math.floor(Math.random() * 2000);
      console.log(
        `[${accountLabel(accountId)}] Пауза ${Math.round(reactDelay / 1000)}с перед реакцией для ${senderName}.`,
      );
      await sleep(reactDelay);
    } else {
      const incomingForDelay = contextualText || text;
      let textDelayMs =
        forcedDelayMs != null
          ? forcedDelayMs
          : opsQ.applyTempoDelay(
              delayBeforeSendMs(settings, outText, {
                accountId,
                incomingText: incomingForDelay,
              }),
              leadSnap?.tier,
            );
      let typeBudget = Math.min(computeTypingMs(outText, accountId), textDelayMs);
      try {
        const shaped = require('./humanRhythm').reshapeDelayPair({
          baseDelayMs: textDelayMs,
          outText,
          incomingText: incomingForDelay,
          accountId,
        });
        textDelayMs = shaped.delayMs;
        typeBudget = shaped.typingMs;
      } catch (_) {
        /* optional */
      }
      let lifeLagApplied = false;
      if (!explicitMediaRequest && !mediaType) {
        try {
          const lag = require('./humanIdeas10').maybeLifeLagMs(incomingForDelay, {
            leadTier: leadSnap?.tier,
          });
          if (lag > textDelayMs) {
            textDelayMs = lag;
            lifeLagApplied = true;
          }
        } catch (_) {
          /* optional */
        }
      }
      // #23 burst + #4 load — не поверх life-lag; потолок обычной паузы ~14с
      if (!lifeLagApplied) {
        try {
          const so = require('./scaleOps');
          let extra = so.burstExtraDelayMs(accountId, peerId) || 0;
          const th = await so.loadThrottleState(accountId);
          if (th.extraDelayMs) extra += th.extraDelayMs;
          // если база уже длинная (reply_delay 8с+) — не раздуваем пачкой
          if (textDelayMs >= 8_000) extra = Math.min(extra, 3_500);
          textDelayMs += extra;
        } catch (_) {
          /* optional */
        }
        textDelayMs = Math.min(textDelayMs, 14_000);
      }
      console.log(
        `[${accountLabel(accountId)}] Пауза ${Math.round(textDelayMs / 1000)}с перед ответом для ${senderName}.`,
      );
      await humanPauseBeforeSend(
        client,
        sender,
        message,
        textDelayMs,
        Math.min(typeBudget, textDelayMs),
        incomingForDelay,
        accountId,
      );
      if (await abortIfPausedOrBlacklisted(accountId, peerId, senderName, 'после паузы (reply)')) {
        return;
      }
    }

    // Пока ждали, другой путь мог уже ответить — не шлём дубль.
    const answeredId = lastAnsweredMsgId.get(inFlightKey);
    if (msgId && answeredId != null && answeredId >= msgId) {
      console.log(
        `[${accountLabel(accountId)}] ${senderName}: пока ждали, сообщение уже отвечено — дубль не отправляю.`,
      );
      return;
    }
    const gapNow = lastReplyAt.get(inFlightKey) || 0;
    if (Date.now() - gapNow < MIN_REPLY_GAP_MS && gapNow > 0) {
      console.log(
        `[${accountLabel(accountId)}] ${senderName}: пока ждали, уже ушёл ответ — дубль не отправляю.`,
      );
      return;
    }
    // Пока печатали/ждали — диалог могли удалить у двоих.
    if (await cancelReplyIfDialogGone(client, accountId, sender, senderName, message, 'после паузы')) {
      return;
    }

    if (reaction) {
      const ok = await sendMessageReaction(client, sender, message, reaction);
      if (ok) {
        lastReplyAt.set(bufferKey(accountId, peerId), Date.now());
        if (msgId) lastAnsweredMsgId.set(inFlightKey, msgId);
        await saveMessage(accountId, peerId, senderName, 'assistant', `[реакция:${reaction}]`);
        console.log(
          `[${accountLabel(accountId)}] Реакция ${reaction} для ${senderName}.`,
        );
      }
    }

    if (outText && lateTextMs > 0) {
      console.log(
        `[${accountLabel(accountId)}] Текст после реакции через ~${Math.round(lateTextMs / 1000)}с для ${senderName}.`,
      );
      await sleep(lateTextMs);
      if (await cancelReplyIfDialogGone(client, accountId, sender, senderName, message, 'после паузы реакции')) {
        return;
      }
      const typeMs = Math.min(2800, computeTypingMs(outText, accountId));
      waitBeforeReply._rethinkChance = humanExtra.getAccountPace(accountId).rethinkChance;
      await waitBeforeReply(client, sender, typeMs, typeMs);
      waitBeforeReply._rethinkChance = undefined;
    }

    if (outText) {
      outText = prepareOutboundText(outText, {
        voiceFileName: voice?.fileName,
        history,
        accountId,
      });
      if (outText) {
        await sendHumanText(client, sender, accountId, peerId, senderName, outText, text);
        lastReplyAt.set(bufferKey(accountId, peerId), Date.now());
        try {
          require('./scaleOps').noteBurstReply(accountId, peerId);
        } catch (_) {}
        if (msgId) lastAnsweredMsgId.set(inFlightKey, msgId);
        await learningDb.recordBotReply(accountId, peerId, text, stripQuestionTags(outText), learningStage);
        console.log(`[${accountLabel(accountId)}] Ответ для ${senderName}: "${stripQuestionTags(outText)}"`);
        if (pendingWorkAside) {
          await maybeSendWorkAside(client, sender, accountId, peerId, senderName, true);
        }
        scheduleAfterthought(accountId, sender, peerId, senderName, outText);
        if (humanHardening.detectLaterTextPromise(outText)) {
          scheduleLaterTextReturn(accountId, sender, peerId, senderName);
        }
      }
    }

    if (laugh && !voice && !nft.sendVoice && !reactionOnly && !laughedRecently(history)) {
      await sendLaughBubble(client, sender, accountId, peerId, senderName);
    }

    // 6.5. Медиа: явная просьба или кружок по смыслу — только если есть медиа-чат.
    let mediaSentThisTurn = false;
    let mediaFailReason = null;
    if (mediaType && mediaLink) {
      humanHardening.logOutboundReason(accountId, accountLabel(accountId), 'media', {
        peer: senderName,
        type: mediaType,
        explicit: explicitMediaRequest ? 1 : 0,
        leak: mediaFromLeak ? 1 : 0,
      });
      const leakHint = /билет|ticket|скрин|прибыл/i.test(String(replyWithoutReact || ''))
        ? ' билет'
        : '';
      const mediaResult = await sendRequestedMediaOrDeflect(
        client,
        sender,
        accountId,
        peerId,
        senderName,
        mediaType,
        mediaLink,
        buildMediaContextText(
          `${outText || ''} ${(contextualText || text || '') + leakHint}`.trim(),
          history,
        ),
        { allowDeflect: explicitMediaRequest || mediaFromLeak || forcedMediaThisTurn },
      );
      mediaSentThisTurn = mediaResult === true || mediaResult?.ok === true;
      if (!mediaSentThisTurn) mediaFailReason = mediaResult?.reason || null;
    }
    await maybeNotifyMediaMissed({
      accountId,
      peerId,
      senderName,
      settings,
      explicitMediaRequest: explicitMediaRequest || mediaFromLeak || forcedMediaThisTurn,
      mediaLink,
      mediaSentThisTurn,
      mediaType,
      text: contextualText || text,
      failReason: mediaFailReason,
    });

    // 7. Если у сработавшего правила voiceOnly=false — следом за текстом
    // отправляем голосовую заготовку (например, voprosy.ogg с вопросами).
    if (voice) {
      // Пауза 3-4 сек между текстом и голосовым + индикатор «записывает».
      try {
        await client.invoke(
          new Api.messages.SetTyping({
            peer: sender,
            action: new Api.SendMessageRecordAudioAction(),
          }),
        );
      } catch (_) {
        // Индикатор н�� критичен.
      }
      await sleep(3000 + Math.random() * 1000);

      try {
        humanHardening.logOutboundReason(accountId, accountLabel(accountId), 'voice', {
          peer: senderName,
          file: voice.fileName,
          voiceOnly: 0,
          afterText: 1,
        });
        await sendVoiceReply(client, sender, voice.filePath);
        await saveMessage(
          accountId,
          peerId,
          senderName,
          'assistant',
          voiceTag(voice.fileName),
        );
        console.log(
          `[${accountLabel(accountId)}] Вслед за ответом отправлена голосовая заготовка для ${senderName}.`,
        );
      } catch (err) {
        if (!isVoiceForbiddenError(err)) throw err;
        voiceForbiddenPeers.add(inFlightKey);
        console.log(`[${accountLabel(accountId)}] ${senderName} запретил голосовые — заготовку пропускаю.`);
      }
    }

    // 8. Третий день знакомства — голосовое с просьбой помочь с NFT-токеном.
    // Отправляем ОДИН раз за весь диалог (метка в истории) и не в тот же ход,
    // когда уже ушло друг��е голосовое или медиа — иначе выглядит ��ак спам.
    if (nft.sendVoice && !voice && !mediaSentThisTurn && !voiceForbiddenPeers.has(inFlightKey)) {
      const nftPath = path.join(VOICES_DIR, NFT_VOICE_FILE);

      if (!fs.existsSync(nftPath)) {
        noteNftVoiceMissing();
      } else if (
        voiceSendInFlight.has(voiceSendKey(accountId, peerId, NFT_VOICE_FILE)) ||
        (await wasVoiceSent(accountId, peerId, NFT_VOICE_FILE))
      ) {
        // Уже отпр��вляется или отправлялось этому человеку — повторно не ш��ём.
      } else {
        const sendKey = voiceSendKey(accountId, peerId, NFT_VOICE_FILE);
        voiceSendInFlight.add(sendKey);
        try {
          try {
            await client.invoke(
              new Api.messages.SetTyping({
                peer: sender,
                action: new Api.SendMessageRecordAudioAction(),
              }),
            );
          } catch (_) {
            // Индикатор не критичен.
          }
          // Пауза чуть больше обычной: голосовое длиннее, «записывает» дольше.
          await sleep(4000 + Math.random() * 3000);

          try {
            humanHardening.logOutboundReason(accountId, accountLabel(accountId), 'nft_voice', {
              peer: senderName,
              file: NFT_VOICE_FILE,
            });
            await sendVoiceReply(client, sender, nftPath);
          } catch (err) {
            if (isVoiceForbiddenError(err)) voiceForbiddenPeers.add(inFlightKey);
            throw err;
          }
          humanHardening.notePitchSent(accountId, peerId);
          await saveMessage(
            accountId,
            peerId,
            senderName,
            'assistant',
            voiceTag(NFT_VOICE_FILE),
          );
          const accountProfile = await client.getMe();
          const accountName = [accountProfile.firstName, accountProfile.lastName]
            .filter(Boolean)
            .join(' ') || (accountProfile.username ? `@${accountProfile.username}` : '');
          await helpRequestNotifier.recordVoiceSent(
            accountId,
            peerId,
            senderName,
            NFT_VOICE_FILE,
            settings.phone,
            accountName,
          );
          // Дальше с этим собеседником ведёт оператор вручную — ИИ замолкает
          // именно в этом диалоге, остальные диалоги аккаунта не затрагиваются.
          await helpRequestNotifier.disableAutoreplyForPeer(accountId, peerId, 'nft_voice_sent');
          try {
            const leadScoring = require('./leadScoring');
            await leadScoring.onLeadBecameReady(accountId, peerId, 'nft_voice_sent');
          } catch (e) {
            console.error(`[${accountLabel(accountId)}] leadReady:`, e.message);
          }
          console.log(
            `[${accountLabel(accountId)}] Отправлено голосовое про NFT (3-й день) для ${senderName}.`,
          );
        } finally {
          voiceSendInFlight.delete(sendKey);
        }
      }
    }

    // 9. «сколько дней на дв» — отдельным сообщением после обычного ответа.
    // Не в ход с просьбой кружка/фото/видео — иначе уход от темы (скрины).
    if (
      outText &&
      allowVoice &&
      !voice &&
      !nft.sendVoice &&
      !mediaSentThisTurn &&
      !detectRequestedMediaType(contextualText || text) &&
      !/\?[)\s]*$/.test(stripQuestionTags(outText)) &&
      // Он о чём-то спросил или дописывает — сначала разговор, вопрос про дв в следующий ход.
      extractUserQuestions(text).length === 0 &&
      // На голое «привет» сначала ответь приветом — «скок на дв» не в тот же ход.
      !heJustGreeted(text) &&
      !pendingAfterInFlight.has(inFlightKey) &&
      !messageBuffers.has(inFlightKey) &&
      (await shouldAskHowLong(accountId, peerId))
    ) {
      howLongInFlight.add(inFlightKey);
      try {
        const question = buildHowLongQuestion();
        await sleep(2500 + Math.random() * 3500);
        try {
          await client.invoke(
            new Api.messages.SetTyping({ peer: sender, action: new Api.SendMessageTypingAction() }),
          );
        } catch (_) {}
        await sleep(1500 + Math.random() * 1500);
        await tgSendMessage(client, sender, { message: question });
        await saveMessage(accountId, peerId, senderName, 'assistant', question);
        lastReplyAt.set(inFlightKey, Date.now());
        console.log(`[${accountLabel(accountId)}] Спросила ${senderName}: "${question}"`);
      } finally {
        howLongInFlight.delete(inFlightKey);
      }
    }
  } catch (err) {
    if (workMentionClaimed) await releaseWorkMention(accountId, peerId).catch(() => {});
    console.error(
      `Ошибка обработки сообщения (аккаунт ${accountId}):`,
      err.message,
    );
    if (/Invalid body|failed to parse JSON/i.test(String(err && err.message))) {
      console.error(
        `[${accountLabel(accountId)}] Invalid body detail:`,
        (err && err.stack) || err,
      );
    }
  } finally {
    if (voiceDialogKey) voiceSendInFlight.delete(voiceDialogKey);
    processingInFlight.delete(inFlightKey);
    const pending = pendingAfterInFlight.get(inFlightKey);
    if (pending?.texts?.length) {
      pendingAfterInFlight.delete(inFlightKey);
      const combined = pending.texts.join('\n').trim();
      const pendingMsgId = pending.message?.id != null ? Number(pending.message.id) : null;
      const deferred = deferredDialogs.get(inFlightKey);
      if (deferred && combined) {
        // Уже «занята» — дописываем новые сообщения в отложенный ответ, без второго хода.
        deferred.text = [deferred.text, combined].filter(Boolean).join('\n');
        deferred.sender = pending.sender || deferred.sender;
        deferred.senderName = pending.senderName || deferred.senderName;
        if (pending.message) deferred.message = pending.message;
        console.log(
          `[${accountLabel(accountId)}] ${pending.senderName}: дописал в паузу «занята», отвечу одним разом.`,
        );
      } else if (
        combined &&
        !(pendingMsgId && lastAnsweredMsgId.get(inFlightKey) === pendingMsgId)
      ) {
        setTimeout(() => {
          processBufferedMessages(
            accountId,
            pending.sender,
            pending.message,
            peerId,
            pending.senderName,
            combined,
          ).catch((e) =>
            console.error(
              `[${accountLabel(accountId)}] Ошибка отложенной догонки:`,
              e.message,
            ),
          );
        }, 800);
      }
    }
  }
}

module.exports = {
  configureReplyPipeline,
  // re-export media (stable API for telegramClient + others)
  voiceForbiddenPeers,
  isVoiceForbiddenError,
  extractMediaRequest,
  resolveMediaPromise,
  trySendMedia,
  sendRequestedMediaOrDeflect,
  stripLeakedMediaHistoryTag,
  // sanitize / send
  sanitizeOutgoingText,
  tgSendMessage,
  sendHumanText,
  maybeTypoPair,
  stripQuestionTags,
  parseReplyBubbles,
  resolveReplyTargets,
  extractReaction,
  shouldSuppressReaction,
  applyReactionGate,
  // re-export how-long
  parseStayDays,
  isAnswerToHowLong,
  shouldAskHowLong,
  howLongInFlight,
  // core reply
  processBufferedMessages,
  fireReengage,
};
