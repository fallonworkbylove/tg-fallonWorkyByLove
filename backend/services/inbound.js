/**
 * Inbound message handling: extract text, buffer/aggregate, defer/gap scheduling.
 * processBufferedMessages / fireReengage / tgSendMessage — через configureInbound.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { Api } = require('telegram');
const { getActiveClient, accountLabel } = require('./clientPool');
const {
  conversationReplyLang,
  saveMessage,
} = require('./history');
const {
  isWithinWorkingHours,
  isNightTextQuietHour,
  waitBeforeReply,
} = require('./timing');
const {
  isPeerBlacklisted,
  isPeerArchived,
  isNeverContact,
} = require('./peers');
const {
  describeImage,
  transcribeAudio,
} = require('./aiResponder');
const { isPhotoRecognitionDisabled } = require('./photoRecognitionSettings');
const humanExtra = require('./humanExtra');
const avatarMatch = require('./avatarMatch');

const execFileAsync = promisify(execFile);

// Лимит скачивания входящего видео (одноразовые тоже). Больше — только превью.
const MAX_INCOMING_VIDEO_BYTES = 28 * 1024 * 1024;
// Telegram view-once: ttl_seconds == 0x7FFFFFFF
const VIEW_ONCE_TTL_SECONDS = 0x7fffffff;

let hooks = {
  processBufferedMessages: null,
  fireReengage: null,
  getAccountSettings: null,
  tgSendMessage: null,
};

function configureInbound(next) {
  hooks = { ...hooks, ...next };
}

// Защита от параллельных обработчиков: пока первое голосовое отправляется,
// повторное сообщение из того же диалога не должно запустить вторую отправку.
const voiceSendInFlight = new Set();

function voiceSendKey(accountId, peerId, fileName) {
  return `${accountId}:${String(peerId)}:${fileName}`;
}

/** GetFile/-503/timeout — один повтор, общий для голоса/фото/видео/стикера. */
async function downloadMediaWithRetry(client, message, opts = {}, label = 'media') {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await client.downloadMedia(message, opts);
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || err.errorMessage || '');
      const retryable = /GetFile|TimedOut|-503|timeout|Not connected|Connection closed/i.test(
        msg,
      );
      if (!retryable || attempt >= 2) throw err;
      console.warn(`[inbound] ${label}: GetFile retry (${msg.slice(0, 80)})`);
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  throw lastErr;
}

// Буфер склейки сообщений. Если собеседник шлёт несколько сообщений подряд,
// мы ждём коротку�� паузу и отвечаем ОДИН раз на ��се сразу — иначе бот
// отвечает на каждое по отдельности и путается в контексте.
// Ключ: `${accountId}:${peerId}`, значение: { texts, timer, sender, message }.
const messageBuffers = new Map();

// Защита от дублей: пока диалог УЖЕ находится внутри processBufferedMessages
// (генерация ответа + человеческая пауза перед отправкой — это ��ожет зан��ть
// заметное время), периодический скан непрочитанных и рассылка приветствий
// не должны повторно брать тот же диалог в обработку. Без этой защиты диалог
// успевал «протухнуть» из messageBuffers/deferredDialogs до отправки ответа,
// и скан запускал вторую (а ин��гда и третью) параллельную генерацию ответа
// на одно и то же сообщение — собеседник получал несколько разных по тексту,
// но по сути повторяющих друг друга сообщений подряд.
// Ключ: тот же bufferKey (`${accountId}:${peerId}`).
const processingInFlight = new Set();

// Не отправляем несколько самостоятельных ответов подряд в одном диалоге.
// Это также защищает от повторного запуска сканером сразу после live-события.
// 45с убивало ветку («3 минуты тишины») — хватает ~10с против дубля сканера.
const lastReplyAt = new Map();
const MIN_REPLY_GAP_MS = 7000;

// Последний telegram message.id, на который уже ушёл ответ в этом диалоге.
// Скан/повторный flush с тем же id не должен слать второй ответ.
const lastAnsweredMsgId = new Map();

// Пока диалог in-flight, новые тексты не дропаем — копятся и обрабатываются
// одним ответом после завершения текущего (иначе скан потом шлёт «дубль»).
const pendingAfterInFlight = new Map();

// Тексты, пришедшие раньше MIN_REPLY_GAP_MS после нашего ответа: ждут конца паузы.
const gapRetries = new Map();

// Сколько ждать следующего сообщения перед тем, как ответить (мс).
// Короткий debounce: склеить «привет» + «как дела» без 8–45с тишины.
// #84: чуть длиннее окно — склеить 2–3 коротких реплики в один ответ.
const AGGREGATE_WINDOW_MS = 3200;

// Максимальное общее время накопления серии (мс). Даже если собеседник
// продолжает печатать без остановки, после этого лимита бот всё равно ответит.
const AGGREGATE_MAX_WAIT_MS = 12000;

// ---------------------------------------------------------------------------
// «ЖИВ����» ИГНОР + РЕ-ЭНГЕЙДЖМЕНТ.
// Иногда бот, вместо того чтобы сразу ответить, ведёт себя как занятой человек:
// молчит некоторое время (5–25 мин), а потом САМ пишет собеседнику вопрос
// («что делаешь?»). Это делает поведение менее «ботским».
// Состояние хранится ТОЛЬКО в памяти процесса: при рестарте таймеры теряю����ся —
// тогда непрочитанный ��иалог утром/через 5 мин подхватит обычный скан.
// Ключ: `${accountId}:${peerId}` (тот же bufferKey) -> { timer, sender, senderName }.
// ---------------------------------------------------------------------------
const deferredDialogs = new Map();
/** fireReengage уже вынул ключ из map и генерит — silence-heal/scan не ставят вторую «Занята». */
const reengageInFlight = new Set();

// Вероятность «замолчать и потом написать самой» вместо обычного ответа (~30–35%).
// Раньше 0.32 — слишком часто: галочки «прочитано» + молчание 5–25 мин
// выглядели как «читает и не отвечает». Редкие паузы оставляем для живости.
const DEFER_CHANCE = 0.08;
// Диапазон паузы перед ре-энгейджментом: от 5 до 25 минут.
const DEFER_MIN_MS = 5 * 60 * 1000;
const DEFER_MAX_MS = 25 * 60 * 1000;
// Минимальная длина истории, чтобы «занятость» не срабатывала в самом начале
// знакомства (иначе бот проигнорит «привет» и покажется мёртвым).
const DEFER_MIN_HISTORY = 4;
// Если во время паузы собеседник пишет снова — отменяем самостоятельный
// ре-энгейджмент и отвечаем именно на его последнее сообщение через небольшую паузу.
// Если написал во время «занята» — ответить скоро, не через 2 минуты.
const DEFER_INTERRUPT_DELAY_MS = 18 * 1000;

function bufferKey(accountId, peerId) {
  return `${accountId}:${peerId}`;
}

/** Текст спойлера / media.spoiler — GramJS отдаёт plaintext в message.message. */
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

async function quotedTextOf(accountId, message) {
  const reply = message && message.replyTo;
  if (!reply) return '';
  const inline = typeof reply.quoteText === 'string' ? reply.quoteText.trim() : '';
  if (inline) return inline.slice(0, 180);

  const replyId = reply.replyToMsgId || message.replyToMsgId;
  if (!replyId) return '';
  const client = getActiveClient(accountId);
  if (!client) return '';
  try {
    const found = await client.getMessages(message.peerId, { ids: [replyId] });
    const original = Array.isArray(found) ? found[0] : found;
    return String(original && original.message || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  } catch (_) {
    return '';
  }
}

/** Срезает служебные ярлыки цитаты — чтобы не было «[уточнение]: [ответ на]: текст». */
function stripQuoteMarkers(text) {
  return String(text || '')
    .replace(
      /\[(?:уточнение к твоей фразе|ответ на(?:\s+его\s+сообщение)?|ответ на твою фразу|Ответ на сообщение(?:\s+собеседника)?)[^\]]*\]:?\s*/gi,
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function withQuote(text, quote) {
  const body = stripQuoteMarkers(text);
  const cited = String(quote || '').replace(/\s+/g, ' ').trim();
  if (!cited) return body;
  if (!body) return `[ответ на «${cited}»]`;
  return `[ответ на «${cited}»]: ${body}`;
}

async function extractIncomingText(accountId, message, peerId, peerUsername) {
  const quote = await quotedTextOf(accountId, message);
  const attach = (text) => withQuote(text, quote);
  // 1. Обычный текст / спойлер-текст (не теряем заблюренное).
  const rawText = extractPlainIncomingText(message);
  const spoiler = messageHasSpoiler(message);
  if (spoiler && rawText.trim()) {
    console.log(
      `[${accountLabel(accountId)}] Спойлер-сообщение: "${rawText.replace(/\s+/g, ' ').slice(0, 120)}"`,
    );
  }

  // 2. Голосовое / аудио (в т.ч. одноразовое с бейджем «1») — скачать, Whisper,
  // для TTL/view-once пометить прослушанным через ReadMessageContents.
  if (message.voice || message.audio) {
    const client = getActiveClient(accountId);
    if (!client) return attach(rawText);

    const onceVoice = isViewOnceOrExpiringMedia(message);
    const voiceLabel = onceVoice ? 'одноразовое голосовое' : 'Голосовое';

    try {
      const buffer = await downloadMediaWithRetry(
        client,
        message,
        {},
        `${accountLabel(accountId)} ${voiceLabel}`,
      );
      if (buffer && buffer.length) {
        if (onceVoice) {
          await markMessageContentsOpened(client, message);
          console.log(
            `[${accountLabel(accountId)}] ${voiceLabel}: скачано (${buffer.length} байт), помечено прослушанным`,
          );
        }
        const transcript = await transcribeAudio(buffer);
        if (transcript) {
          return attach(
            rawText
              ? `${rawText}\n[${voiceLabel}]: ${transcript}`
              : `[${voiceLabel}]: ${transcript}`,
          );
        }
        // Пустая расшифровка — всё равно даём AI зацепку, иначе молчание.
        return attach(rawText || `[${voiceLabel}]: не разобрала`);
      } else if (onceVoice) {
        // Пустой download — всё равно снимаем «1», иначе висит непрослушанным.
        await markMessageContentsOpened(client, message);
      }
    } catch (e) {
      console.error(
        `[${accountLabel(accountId)}] Не удалось расшифровать ${voiceLabel}:`,
        e.message,
      );
      if (onceVoice) {
        try {
          await markMessageContentsOpened(client, message);
        } catch (_) {}
      }
      return attach(rawText || `[${voiceLabel}]: не разобрала`);
    }

    return attach(rawText || `[${voiceLabel}]: не разобрала`);
  }

  // 3. Фото — распознаём соде��жимое, кр��ме чатов из списка исключений
  // (распознавание для них отключено во всех сессиях пользователя) и кроме
  // соб��седников, спр��танн��х в АРХИВ (folder_id = 1) — им фото не разбираем.
  if (message.photo) {
    const photoFallback = (extra) => {
      const once = isViewOnceOrExpiringMedia(message) ? 'одноразовое ' : '';
      const spoil = !once && spoiler ? 'спойлер-' : '';
      const caption = rawText ? ` Подпись: "${rawText}".` : '';
      return attach(
        rawText
          ? `[${once}${spoil}фото от собеседника]: ${extra || 'фото'}.${caption}`
          : `[${once}${spoil}фото от собеседника]${extra ? `: ${extra}` : ''}`,
      );
    };

    if (peerId && (await isPhotoRecognitionDisabled(accountId, peerId, peerUsername))) {
      console.log(
        `[${accountLabel(accountId)}] Распознавание фото отключено для этого чата — плейсхолдер.`,
      );
      return photoFallback('распознавание выкл');
    }

    const client = getActiveClient(accountId);
    if (!client) return photoFallback('не скачала');

    try {
      const inputPeer = await message.getInputSender();
      if (inputPeer && (await isPeerArchived(client, inputPeer))) {
        console.log(
          `[${accountLabel(accountId)}] Собеседник в архиве — не распознаю фото.`,
        );
        return attach(rawText);
      }
    } catch (e) {
      console.error('Не удалось проверить архив перед распознаванием фото:', e.message);
    }

    try {
      const buffer = await downloadMediaWithRetry(
        client,
        message,
        {},
        `${accountLabel(accountId)} фото`,
      );
      if (buffer && buffer.length) {
        const visionLang = peerId
          ? await conversationReplyLang(accountId, peerId, rawText)
          : 'ru';
        const description = await describeImage(buffer, rawText, visionLang);
        let ownAvatarTag = '';
        try {
          const isOwn = await avatarMatch.matchesOwnAccountAvatar(
            client,
            accountId,
            buffer,
            message,
            { caption: rawText },
          );
          if (isOwn) {
            ownAvatarTag = ` ${avatarMatch.OWN_AVATAR_TAG}`;
            console.log(
              `[${accountLabel(accountId)}] Входящее фото = аватарка аккаунта.`,
            );
          }
        } catch (e) {
          console.warn(
            `[${accountLabel(accountId)}] avatarMatch:`,
            e?.message || e,
          );
        }
        if (isViewOnceOrExpiringMedia(message) || spoiler) {
          await markMessageContentsOpened(client, message);
        }
        if (description || ownAvatarTag) {
          console.log(
            `[${accountLabel(accountId)}] Фото распознано: "${description || '—'}"${ownAvatarTag}`,
          );
          const caption = rawText ? ` Подпись: "${rawText}".` : '';
          const once = isViewOnceOrExpiringMedia(message) ? 'одноразовое ' : '';
          const spoil = spoiler && !once ? 'спойлер-' : '';
          return attach(
            `[${once}${spoil}фото от собеседника]: ${description || 'фото'}.${ownAvatarTag}${caption}`,
          );
        }
      }
    } catch (e) {
      console.error('Не удалось скачать/распознать фото:', e.message);
    }
    if (spoiler) {
      try {
        await markMessageContentsOpened(client, message);
      } catch (_) {}
    }
    // Без подписи раньше был пустой текст → полный mute. Как у видео — fallback.
    return photoFallback('не разобрала');
  }

  // 4. Видео / кружок / одноразовое видео — скачиваем, смотрим кадры, помечаем просмотренным.
  if (isVideoMessage(message)) {
    if (peerId && (await isPhotoRecognitionDisabled(accountId, peerId, peerUsername))) {
      const label = isViewOnceMedia(message)
        ? 'одноразовое видео'
        : message.videoNote
          ? 'кружок'
          : 'видео';
      const caption = rawText ? ` Подпись: "${rawText}".` : '';
      console.log(
        `[${accountLabel(accountId)}] Распознавание медиа отключено — плейсхолдер ${label}.`,
      );
      return attach(
        rawText
          ? `[${label} от собеседника]: распознавание выкл.${caption}`
          : `[${label} от собеседника]`,
      );
    }
    const videoText = await extractIncomingVideoText(accountId, message, rawText);
    if (spoiler) {
      const client = getActiveClient(accountId);
      if (client) {
        try {
          await markMessageContentsOpened(client, message);
        } catch (_) {}
      }
    }
    return attach(videoText);
  }

  // 5. Стикер — раньше отбрасывался (пустой message.message), из‑за этого
  // «ЗДРАСТИ»/привет-стикеры оставались без ответа.
  if (isStickerMessage(message)) {
    return attach(await extractStickerText(accountId, message, rawText, peerId));
  }

  // 6. Прочее — текст/спойлер-текст + цитата. Спойлер НЕ пропускаем.
  if (spoiler && !String(rawText || '').trim() && !quote) {
    console.log(`[${accountLabel(accountId)}] Пустой спойлер без текста — пропускаю ответ.`);
    return '';
  }
  return attach(rawText);
}

const GREETING_STICKER_TEXT_RE =
  /(здравств|здрасте|здрасти|здрасьт|привет|приветик|хай|хелло|hello|\bhi\b|good\s*morning|доброе|добрый)/i;
const GREETING_STICKER_EMOJI_RE = /[👋🤟🤗🙋]|wave/i;

function mediaTtlSeconds(message) {
  const ttl = message?.media?.ttlSeconds;
  return typeof ttl === 'number' ? ttl : null;
}

function isViewOnceOrExpiringMedia(message) {
  const ttl = mediaTtlSeconds(message);
  return ttl != null && ttl > 0;
}

function isViewOnceMedia(message) {
  const ttl = mediaTtlSeconds(message);
  return ttl === VIEW_ONCE_TTL_SECONDS || ttl === 2147483647;
}

async function markMessageContentsOpened(client, message) {
  if (!client || !message?.id) return;
  try {
    await client.invoke(new Api.messages.ReadMessageContents({ id: [message.id] }));
  } catch (err) {
    console.error(
      `[markMessageContentsOpened] ReadMessageContents #${message.id}:`,
      err.message,
    );
  }
}

function isVideoMessage(message) {
  if (!message) return false;
  if (message.voice || message.audio || message.photo) return false;
  if (isStickerMessage(message)) return false;
  if (message.video || message.videoNote || message.gif) return true;
  if (message.media && message.media.video === true) return true;
  const doc = message.document;
  if (!doc) return false;
  const mime = String(doc.mimeType || '').toLowerCase();
  if (mime.startsWith('video/')) return true;
  if (!Array.isArray(doc.attributes)) return false;
  return doc.attributes.some((attr) => {
    const name = String(attr?.className || '');
    return (
      name.includes('DocumentAttributeVideo') ||
      name.includes('DocumentAttributeAnimated') ||
      attr.roundMessage === true
    );
  });
}

/**
 * Достаёт 1–3 кадра из видео через ffmpeg (нужен на сервере).
 */
async function extractVideoFrameBuffers(videoBuffer, maxFrames = 3) {
  if (!videoBuffer || !videoBuffer.length) return [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tgvid-'));
  const inPath = path.join(tmp, 'in.mp4');
  try {
    fs.writeFileSync(inPath, videoBuffer);
    let duration = 0;
    try {
      const { stdout } = await execFileAsync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          inPath,
        ],
        { timeout: 20000, windowsHide: true },
      );
      duration = Math.max(0, Number.parseFloat(String(stdout).trim()) || 0);
    } catch (_) {
      duration = 0;
    }

    const stamps = [];
    if (duration >= 0.4) {
      for (let i = 0; i < maxFrames; i += 1) {
        const t = ((i + 0.35) / maxFrames) * duration;
        stamps.push(Math.min(Math.max(0, t), Math.max(0, duration - 0.05)));
      }
    } else {
      stamps.push(0);
    }

    const frames = [];
    for (let i = 0; i < stamps.length; i += 1) {
      const outPath = path.join(tmp, `frame_${i}.jpg`);
      try {
        await execFileAsync(
          'ffmpeg',
          [
            '-y',
            '-ss',
            stamps[i].toFixed(2),
            '-i',
            inPath,
            '-frames:v',
            '1',
            '-q:v',
            '3',
            outPath,
          ],
          { timeout: 25000, windowsHide: true },
        );
        if (fs.existsSync(outPath)) {
          const buf = fs.readFileSync(outPath);
          if (buf.length > 100) frames.push(buf);
        }
      } catch (_) {
        // один кадр не вышел — пробуем следующий
      }
    }
    return frames;
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {
      // ignore
    }
  }
}

/**
 * Видео / одноразовое видео / кружок → текст для AI.
 * Скачиваем файл, смотрим кадры (vision), при наличии звука — Whisper,
 * для TTL/view-once помечаем просмотренным через ReadMessageContents.
 */
async function extractIncomingVideoText(accountId, message, rawText) {
  const client = getActiveClient(accountId);
  const viewOnce = isViewOnceMedia(message);
  const expiring = isViewOnceOrExpiringMedia(message);
  const label = viewOnce
    ? 'одноразовое видео'
    : message.videoNote
      ? 'кружок'
      : 'видео';

  if (!client) {
    return rawText || `[${label} от собеседника]`;
  }

  const peerId = message.senderId ? String(message.senderId) : '';
  const visionLang = peerId
    ? await conversationReplyLang(accountId, peerId, rawText)
    : 'ru';

  let opened = false;
  const markOpened = async () => {
    if (opened || !expiring) return;
    opened = true;
    await markMessageContentsOpened(client, message);
  };

  try {
    const buffer = await downloadMediaWithRetry(
      client,
      message,
      {},
      `${accountLabel(accountId)} ${label}`,
    );
    if (!buffer || !buffer.length) {
      console.log(
        `[${accountLabel(accountId)}] ${label}: пустой downloadMedia`,
      );
      return rawText || `[${label} от собеседника]: не удалось скачать`;
    }

    let frameBuffers = [];
    let transcript = '';

    if (buffer.length <= MAX_INCOMING_VIDEO_BYTES) {
      frameBuffers = await extractVideoFrameBuffers(buffer, 3);
      try {
        transcript = (await transcribeAudio(buffer, 'video.mp4')) || '';
      } catch (e) {
        console.error(
          `[${accountLabel(accountId)}] Whisper по видео:`,
          e.message,
        );
      }
    } else {
      console.log(
        `[${accountLabel(accountId)}] ${label} слишком большое (${buffer.length} байт) — только превью`,
      );
      try {
        const thumb = await client.downloadMedia(message, { thumb: 0 });
        if (thumb && thumb.length) frameBuffers = [thumb];
      } catch (_) {
        // ignore
      }
    }

    if (!frameBuffers.length) {
      try {
        const thumb = await client.downloadMedia(message, { thumb: 0 });
        if (thumb && thumb.length) frameBuffers.push(thumb);
      } catch (_) {
        // ignore
      }
    }

    const descriptions = [];
    for (const frame of frameBuffers.slice(0, 3)) {
      try {
        const d = await describeImage(frame, rawText || `кадр из ${label}`, visionLang);
        if (d) descriptions.push(d);
      } catch (e) {
        console.error(
          `[${accountLabel(accountId)}] Vision по кадру видео:`,
          e.message,
        );
      }
    }

    await markOpened();

    const parts = [];
    if (descriptions.length) {
      parts.push(
        descriptions.length === 1
          ? descriptions[0]
          : descriptions.map((d, i) => `(кадр ${i + 1}) ${d}`).join(' '),
      );
    }
    if (transcript) {
      parts.push(`на видео сказано: «${transcript}»`);
    }
    if (!parts.length) {
      parts.push('короткое видео, деталей не разобрала');
    }

    const caption = rawText ? ` Подпись: "${rawText}".` : '';
    const result = `[${label} от собеседника]: ${parts.join('. ')}.${caption}`;
    console.log(
      `[${accountLabel(accountId)}] ${label} обработано: "${result.slice(0, 180)}"`,
    );
    return result;
  } catch (err) {
    console.error(
      `[${accountLabel(accountId)}] Не удалось обработать ${label}:`,
      err.message,
    );
    await markOpened();
    return rawText || `[${label} от собеседника]`;
  }
}

function isStickerMessage(message) {
  if (!message) return false;
  if (message.sticker) return true;
  const doc = message.document;
  if (!doc || !Array.isArray(doc.attributes)) return false;
  return doc.attributes.some((attr) => {
    const name = String(attr?.className || '');
    return (
      name.includes('Sticker') ||
      attr.stickerset != null ||
      (typeof attr.alt === 'string' && attr.alt && name.includes('DocumentAttribute'))
    );
  });
}

function getStickerEmoji(message) {
  const doc = message.sticker || message.document;
  if (!doc || !Array.isArray(doc.attributes)) return '';
  for (const attr of doc.attributes) {
    if (typeof attr.alt === 'string' && attr.alt.trim()) return attr.alt.trim();
  }
  return '';
}

/**
 * Стикер → текст для буфера/AI. Приветственные стикеры нормализуем в «привет»,
 * чтобы сработали голосовые триггеры и модель ответила приветствием.
 */
async function extractStickerText(accountId, message, rawText, peerId = null) {
  const emoji = getStickerEmoji(message);
  let description = '';

  const client = getActiveClient(accountId);
  if (client) {
    try {
      const buffer = await downloadMediaWithRetry(
        client,
        message,
        {},
        `${accountLabel(accountId)} стикер`,
      );
      if (buffer && buffer.length) {
        const visionLang = peerId
          ? await conversationReplyLang(accountId, peerId, rawText || emoji)
          : 'ru';
        description = (await describeImage(buffer, emoji || 'стикер', visionLang)) || '';
        if (description) {
          console.log(
            `[${accountLabel(accountId)}] Стикер распознан: "${description}"`,
          );
        }
      }
    } catch (e) {
      console.error(
        `[${accountLabel(accountId)}] Не удалось скачать/распознать стикер:`,
        e.message,
      );
    }
  }

  const blob = `${emoji} ${description} ${rawText}`.trim();
  const isGreeting =
    GREETING_STICKER_TEXT_RE.test(blob) || GREETING_STICKER_EMOJI_RE.test(emoji);

  if (isGreeting) {
    // «привет» в начале — для triggers.json (voprosy.ogg) и естественного ответа.
    const detail = description || emoji || 'поздоровался стикером';
    return `привет\n[стикер-приветствие]: ${detail}`;
  }

  // Любой другой стикер всё равно не игнорируем — пусть AI коротко отреагирует.
  const detail = description || emoji || 'без текста';
  return `[стикер от собеседника]: ${detail}`;
}

async function handleIncomingMessage(accountId, event) {
  try {
    const message = event.message;
    if (!message) return;

    // Фильтр 1: только личные чаты (не группы/каналы)
    if (!message.isPrivate) return;

    // Отправитель — нужен УЖЕ СЕЙЧАС (до распознавания фото), чтобы можно
    // было проверить, не входит ли этот чат в список исключений.
    const sender = await message.getSender();

    // Фильтр 2: игнорируем ботов
    if (sender && (sender.bot || isNeverContact(sender))) return;

    const peerId = sender ? String(sender.id) : String(message.senderId);
    const peerUsername = sender ? sender.username : null;
    const senderName = sender
      ? sender.username || sender.firstName || peerId
      : peerId;

    if (await isPeerBlacklisted(accountId, peerId)) return;

    // Архив: не читаем и не отвечаем. Проверяем ДО Whisper/vision/буфера,
    // чтобы вообще не трогать диалог.
    const clientEarly = getActiveClient(accountId);
    if (clientEarly && sender && (await isPeerArchived(clientEarly, sender))) {
      console.log(
        `[${accountLabel(accountId)}] ${senderName} в архиве — игнорирую (не читаю, не отвечаю).`,
      );
      try {
        require('./leadScoring').markPeerArchived(accountId, peerId).catch(() => {});
      } catch (_) {
        /* ignore */
      }
      return;
    }

    // AI выключен — не жжём Whisper/vision. Клиент может оставаться online.
    if (typeof hooks.getAccountSettings === 'function') {
      const settingsEarly = await hooks.getAccountSettings(accountId);
      if (!settingsEarly || Number(settingsEarly.is_autoreply_enabled) !== 1) {
        return;
      }
    }

    // Очищенный в кабинете чат: новое входящее снова открывает диалог.
    try {
      require('./leadScoring').unmarkPeerCleared(accountId, peerId).catch(() => {});
    } catch (_) {
      /* ignore */
    }

    // Не ставим «прочитано» здесь: иначе при паузе «занята» / отключённом
    // автоответе собеседник видит галочки без ответа. Читаем в processBufferedMessages
    // только когда реально отвечаем.

    // Фильтр 3: извлекаем текст. Голосовые расшифровываем (Whisper),
    // фото/видео распознаём (vision + кадры), одноразовые медиа открываем.
    // Для чатов из списка исключений распознавание фото пропускается.
    const text = await extractIncomingText(accountId, message, peerId, peerUsername);
    if (!text || !text.trim()) return;

    const key = bufferKey(accountId, peerId);
    const existing = messageBuffers.get(key);

    if (existing) {
      // Уже копим сообщения от этого собеседника — добавляем текст
      // и перезапускаем таймер ожидания. Одинаковый текст (ретрай TG /
      // GetDifference) не копим второй раз.
      if (!existing.texts.includes(text)) existing.texts.push(text);
      existing.sender = sender;
      existing.message = message;
      clearTimeout(existing.timer);

      // Не даём серии тяну��ься бесконечно: ограничиваем таймер так, чтобы
      // общее ожидание не превысило AGGREGATE_MAX_WAIT_MS.
      const elapsed = Date.now() - existing.startedAt;
      const remaining = Math.max(0, AGGREGATE_MAX_WAIT_MS - elapsed);
      let windowMs = AGGREGATE_WINDOW_MS;
      try {
        windowMs = require('./humanRhythm').aggregateWindowMs(text, AGGREGATE_WINDOW_MS);
      } catch (_) {
        /* optional */
      }
      const wait = Math.min(windowMs, remaining);

      existing.timer = setTimeout(
        () => flushMessageBuffer(accountId, peerId, senderName),
        wait,
      );
      console.log(
        `[${accountLabel(accountId)}] +соо��щение от ${senderName}, жду паузу (${existing.texts.length} в очереди).`,
      );
      return;
    }

    // Первое сообщение серии — создаём буфер и запускаем таймер.
    let firstWindow = AGGREGATE_WINDOW_MS;
    try {
      firstWindow = require('./humanRhythm').aggregateWindowMs(text, AGGREGATE_WINDOW_MS);
    } catch (_) {
      /* optional */
    }
    const entry = {
      texts: [text],
      sender,
      message,
      startedAt: Date.now(),
      timer: setTimeout(
        () => flushMessageBuffer(accountId, peerId, senderName),
        firstWindow,
      ),
    };
    messageBuffers.set(key, entry);
  } catch (err) {
    console.error(
      `Ошибка приёма с��общения (аккаунт ${accountId}):`,
      err.message,
    );
  }
}

/**
 * Срабатывает по истечении паузы: собирает накопленные со��бщения
 * собеседни��а в один текст и передаёт в обработку.
 */
async function flushMessageBuffer(accountId, peerId, senderName) {
  const key = bufferKey(accountId, peerId);
  const entry = messageBuffers.get(key);
  if (!entry) return;

  messageBuffers.delete(key);

  // Пустые «ок/ага/аа» из пачки выкидываем, если есть живая строка.
  const kept = humanExtra.filterBoringBatch(entry.texts);
  const combinedText = kept.join('\n').trim();
  if (!combinedText) return;

  await hooks.processBufferedMessages(
    accountId,
    entry.sender,
    entry.message,
    peerId,
    senderName,
    combinedText,
  );
}

/**
 * Планирует «занятость»: бот молчит случайные 10–60 минут, а потом всё равно
 * ОТВЕЧАЕТ ПО СУЩЕСТВУ на то сообщение, из-за которого сработала пауза —
 * прост�� с большой естественной за��ержкой, как будто был занят д��лами.
 * Раньше здесь отправлялась шаблонная фраза («что делаешь?», «ты тут?») —
 * это приводило к тому, что реальный вопрос собеседника оставался б��з ответа.
 * Если пауза для этого диалога уже идёт — второй раз не планируем.
 */
/**
 * Редкая досылка «а ещё)» через 20–90с — как дописала мысль.
 * Не шлём, если уже идёт буфер / занятость / in-flight.
 */
/**
 * #14: бот сказала «напишу позже» — реально вернуться через 15–90 мин
 * короткой фразой, если он сам не написал (cancelDeferredText на входящем).
 */
async function fireOneLaterTextReturn(accountId, peerId, senderHint, senderNameHint) {
  let hh;
  try {
    hh = require('./humanHardening');
  } catch (_) {
    return false;
  }
  const key = bufferKey(accountId, peerId);
  const due = hh.takeDueDeferredText(accountId, peerId);
  if (!due) return false;
  if (messageBuffers.has(key) || deferredDialogs.has(key) || processingInFlight.has(key)) {
    return false;
  }
  const { getActiveClient, accountLabel } = require('./clientPool');
  const client = getActiveClient(accountId);
  if (!client) return false;
  if (!isWithinWorkingHours(accountId)) return false;
  if (isNightTextQuietHour()) return false;
  const settings =
    typeof hooks.getAccountSettings === 'function'
      ? await hooks.getAccountSettings(accountId)
      : null;
  if (!settings || Number(settings.is_autoreply_enabled) !== 1) return false;
  const helpRequestNotifier = require('./helpRequestNotifier');
  if (await helpRequestNotifier.isAutoreplyDisabledForPeer(accountId, peerId)) return false;
  let sender = senderHint;
  if (sender == null || typeof sender === 'string' || typeof sender === 'number') {
    try {
      sender = await client.getEntity(peerId);
    } catch (_) {
      return false;
    }
  }
  const senderName = senderNameHint || sender.username || sender.firstName || peerId;
  // Без «отвлеклась» — клише из логов (0mj).
  const phrases = ['тут)', 'ой сорри)', 'я снова)', 'ну что, я тут)', 'сек, была занята)'];
  const phrase = phrases[Math.floor(Math.random() * phrases.length)];
  if (typeof hooks.tgSendMessage !== 'function') return false;
  await waitBeforeReply(client, sender, 900 + Math.random() * 1200, 800);
  await hooks.tgSendMessage(client, sender, { message: phrase });
  await saveMessage(accountId, peerId, senderName, 'assistant', phrase);
  lastReplyAt.set(key, Date.now());
  hh.logOutboundReason(accountId, accountLabel(accountId), 'later_text', {
    peer: senderName,
    phrase,
  });
  try {
    require('./opsLiveMetrics').bump('textPromiseFire');
  } catch (_) {}
  return true;
}

/** Тик после рестарта: due «напишу позже» из RAM/БД. */
async function flushDueTextPromises() {
  let hh;
  try {
    hh = require('./humanHardening');
  } catch (_) {
    return 0;
  }
  const due = hh.peekDueDeferredTexts();
  let n = 0;
  for (const row of due) {
    try {
      if (await fireOneLaterTextReturn(row.accountId, row.peerId)) n += 1;
    } catch (e) {
      console.error(`[account ${row.accountId}] flush text promise:`, e.message);
    }
  }
  return n;
}

function scheduleLaterTextReturn(accountId, sender, peerId, senderName) {
  let hh;
  try {
    hh = require('./humanHardening');
  } catch (_) {
    return;
  }
  const delay = 15 * 60 * 1000 + Math.floor(Math.random() * 75 * 60 * 1000);
  hh.scheduleDeferredText(accountId, peerId, { delayMs: delay });
  const timer = setTimeout(() => {
    fireOneLaterTextReturn(accountId, peerId, sender, senderName).catch((e) =>
      console.error(`[account ${accountId}] laterTextReturn:`, e.message),
    );
  }, delay + 30);
  if (typeof timer.unref === 'function') timer.unref();
}

/**
 * «Скину потом» — реально дослать фото через delay (иначе promise мёртвый).
 */
async function fireOneDeferredMedia(accountId, peerId, senderHint, senderNameHint) {
  let hh;
  try {
    hh = require('./humanHardening');
  } catch (_) {
    return false;
  }
  const due = hh.takeDueDeferredMedia(accountId, peerId);
  if (!due) return false;
  const key = bufferKey(accountId, peerId);
  if (messageBuffers.has(key) || deferredDialogs.has(key) || processingInFlight.has(key)) {
    // вернём в очередь на чуть позже
    hh.scheduleDeferredMedia(accountId, peerId, {
      ...due,
      delayMs: 60 * 1000 + Math.floor(Math.random() * 120000),
    });
    return false;
  }
  const { getActiveClient, accountLabel } = require('./clientPool');
  const client = getActiveClient(accountId);
  if (!client) return false;
  if (!isWithinWorkingHours(accountId) || isNightTextQuietHour()) {
    hh.scheduleDeferredMedia(accountId, peerId, {
      ...due,
      delayMs: 20 * 60 * 1000,
    });
    return false;
  }
  const settings =
    typeof hooks.getAccountSettings === 'function'
      ? await hooks.getAccountSettings(accountId)
      : null;
  if (!settings || Number(settings.is_autoreply_enabled) !== 1) return false;
  const mediaLink =
    typeof settings.media_chat_link === 'string' ? settings.media_chat_link.trim() : '';
  if (!mediaLink) return false;
  const helpRequestNotifier = require('./helpRequestNotifier');
  if (await helpRequestNotifier.isAutoreplyDisabledForPeer(accountId, peerId)) return false;
  let sender = senderHint;
  if (sender == null || typeof sender === 'string' || typeof sender === 'number') {
    try {
      sender = await client.getEntity(peerId);
    } catch (_) {
      return false;
    }
  }
  const senderName = senderNameHint || sender.username || sender.firstName || peerId;
  const kind = due.kind === 'video' || due.kind === 'circle' ? due.kind : 'photo';
  const mediaSend = require('./mediaSend');
  const phrase = ['вот)', 'скинула)', 'держи)'][Math.floor(Math.random() * 3)];
  if (typeof hooks.tgSendMessage === 'function') {
    await waitBeforeReply(client, sender, 800 + Math.random() * 1000, 600);
    await hooks.tgSendMessage(client, sender, { message: phrase });
    await saveMessage(accountId, peerId, senderName, 'assistant', phrase);
  }
  const sent = await mediaSend.trySendMedia(
    client,
    sender,
    accountId,
    peerId,
    senderName,
    kind,
    mediaLink,
    'скинула как обещала',
  );
  hh.logOutboundReason(accountId, accountLabel(accountId), 'deferred_media', {
    peer: senderName,
    kind,
    ok: !!(sent && sent.ok),
  });
  return !!(sent && sent.ok);
}

function scheduleDeferredMediaReturn(accountId, sender, peerId, senderName, job) {
  const delay = Math.max(1000, (job && job.dueAt ? job.dueAt - Date.now() : 30 * 60 * 1000));
  const timer = setTimeout(() => {
    fireOneDeferredMedia(accountId, peerId, sender, senderName).catch((e) =>
      console.error(`[account ${accountId}] deferredMedia:`, e.message),
    );
  }, delay + 50);
  if (typeof timer.unref === 'function') timer.unref();
}

async function flushDueDeferredMedia() {
  let hh;
  try {
    hh = require('./humanHardening');
  } catch (_) {
    return 0;
  }
  const due = hh.peekDueDeferredMedias();
  let n = 0;
  for (const row of due) {
    try {
      if (await fireOneDeferredMedia(row.accountId, row.peerId)) n += 1;
    } catch (e) {
      console.error(`[account ${row.accountId}] flush deferred media:`, e.message);
    }
  }
  return n;
}

function scheduleAfterthought(accountId, sender, peerId, senderName, prevOutText) {
  try {
    const { looksLikeFarewell } = require('./dailyLife');
    if (looksLikeFarewell(prevOutText)) return;
  } catch (_) {
    /* optional */
  }
  const delay = humanExtra.afterthoughtDelayMs(accountId);
  const phrase = humanExtra.pickAfterthought(prevOutText);
  if (!delay || !phrase) return;
  const key = bufferKey(accountId, peerId);
  const timer = setTimeout(() => {
    (async () => {
      try {
        if (messageBuffers.has(key) || deferredDialogs.has(key) || processingInFlight.has(key)) {
          return;
        }
        const helpRequestNotifier = require('./helpRequestNotifier');
        const { isPeerBlacklisted } = require('./peers');
        if (await helpRequestNotifier.isAutoreplyDisabledForPeer(accountId, peerId)) {
          console.log(
            `[${accountLabel(accountId)}] afterthought: пауза/handoff для ${senderName} — не шлю.`,
          );
          return;
        }
        if (await isPeerBlacklisted(accountId, peerId)) return;
        const client = getActiveClient(accountId);
        if (!client) return;
        const settings = await hooks.getAccountSettings(accountId);
        if (!settings || Number(settings.is_autoreply_enabled) !== 1) return;
        if (typeof hooks.tgSendMessage !== 'function') return;
        if (!isWithinWorkingHours(accountId)) return;
        if (isNightTextQuietHour()) return;
        await waitBeforeReply(client, sender, 900 + Math.random() * 1200, 800);
        if (await helpRequestNotifier.isAutoreplyDisabledForPeer(accountId, peerId)) return;
        await hooks.tgSendMessage(client, sender, { message: phrase });
        await saveMessage(accountId, peerId, senderName, 'assistant', phrase);
        lastReplyAt.set(key, Date.now());
        console.log(
          `[${accountLabel(accountId)}] Досылка «${phrase}» для ${senderName} (+${Math.round(delay / 1000)}с).`,
        );
      } catch (e) {
        console.error(`[${accountLabel(accountId)}] afterthought:`, e.message);
      }
    })();
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
}

function scheduleReengage(accountId, sender, peerId, senderName, history, text, message, opts = {}) {
  const key = bufferKey(accountId, peerId);
  if (deferredDialogs.has(key) || reengageInFlight.has(key)) return;

  let delay = opts.delayMs;
  if (delay == null) {
    try {
      delay = require('./scaleOps').pickBusyDelayMs({
        userText: text,
        explicitMedia: !!opts.explicitMedia,
        historyLen: Array.isArray(history) ? history.length : 0,
      });
    } catch (_) {
      delay = DEFER_MIN_MS + Math.floor(Math.random() * (DEFER_MAX_MS - DEFER_MIN_MS));
    }
  }
  const timer = setTimeout(() => {
    hooks.fireReengage(accountId, peerId).catch((e) =>
      console.error(
        `[${accountLabel(accountId)}] Ошибка отложенного ответа:`,
        e.message,
      ),
    );
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();

  deferredDialogs.set(key, { timer, sender, senderName, history, text, message });
  try {
    require('./scaleOps')
      .persistBusy({
        accountId,
        peerId,
        senderName,
        text,
        delayMs: delay,
      })
      .catch(() => {});
  } catch (_) {}
  console.log(
    `[${accountLabel(accountId)}] «Занята»: молчу ${Math.round(
      delay / 60000,
    )} мин для ${senderName}, потом отвечу на её сообщение.`,
  );
  try {
    require('./opsLiveMetrics').bump('busyDefer');
  } catch (_) {}
}

function scheduleGapRetry(accountId, sender, message, peerId, senderName, text, waitMs) {
  const key = bufferKey(accountId, peerId);
  const existing = gapRetries.get(key);
  if (existing) {
    if (text && !existing.texts.includes(text)) existing.texts.push(text);
    existing.sender = sender || existing.sender;
    existing.message = message || existing.message;
    existing.senderName = senderName || existing.senderName;
    return;
  }
  const entry = { texts: text ? [text] : [], sender, message, senderName, timer: null };
  entry.timer = setTimeout(() => {
    gapRetries.delete(key);
    const combined = entry.texts.join('\n').trim();
    if (!combined) return;
    const buffered = messageBuffers.get(key);
    if (buffered) {
      buffered.texts.unshift(...entry.texts);
      return;
    }
    const deferred = deferredDialogs.get(key);
    if (deferred) {
      deferred.text = [combined, deferred.text].filter(Boolean).join('\n');
      return;
    }
    hooks.processBufferedMessages(accountId, entry.sender, entry.message, peerId, entry.senderName, combined).catch((e) =>
      console.error(`[${accountLabel(accountId)}] Ошибка отложенного ответа после паузы:`, e.message),
    );
  }, waitMs);
  gapRetries.set(key, entry);
}

/**
 * Сразу отправить все «Занята»/deferred — не ждать 6–20 мин.
 * Возвращает число запущенных fireReengage.
 */
function flushAllDeferredNow() {
  const keys = [...deferredDialogs.keys()];
  let n = 0;
  for (const key of keys) {
    const entry = deferredDialogs.get(key);
    if (!entry) continue;
    try {
      clearTimeout(entry.timer);
    } catch (_) {}
    const colon = key.indexOf(':');
    if (colon < 0) continue;
    const accountId = key.slice(0, colon);
    const peerId = key.slice(colon + 1);
    if (typeof hooks.fireReengage !== 'function') continue;
    hooks.fireReengage(accountId, peerId).catch((e) =>
      console.error(
        `[${accountLabel(accountId)}] flushDeferred ${peerId}:`,
        e.message,
      ),
    );
    n += 1;
  }
  if (n > 0) {
    console.log(`[inbound] flushAllDeferredNow: запущено ${n} отложенных ответов.`);
  }
  return n;
}

/**
 * Сброс inbound Maps/таймеров для аккаунта (logout / deactivate).
 */
function clearInboundAccountRuntime(accountId) {
  const prefix = `${accountId}:`;
  for (const [key, entry] of deferredDialogs) {
    if (key.startsWith(prefix)) {
      clearTimeout(entry.timer);
      deferredDialogs.delete(key);
    }
  }
  try {
    require('./scaleOps').clearBusyForAccount(accountId).catch(() => {});
  } catch (_) {}
  for (const [key, entry] of messageBuffers) {
    if (!key.startsWith(prefix)) continue;
    clearTimeout(entry.timer);
    messageBuffers.delete(key);
  }
  for (const key of processingInFlight) {
    if (key.startsWith(prefix)) processingInFlight.delete(key);
  }
  for (const key of lastReplyAt.keys()) {
    if (key.startsWith(prefix)) lastReplyAt.delete(key);
  }
  for (const key of lastAnsweredMsgId.keys()) {
    if (key.startsWith(prefix)) lastAnsweredMsgId.delete(key);
  }
  for (const key of pendingAfterInFlight.keys()) {
    if (key.startsWith(prefix)) pendingAfterInFlight.delete(key);
  }
  for (const [key, entry] of gapRetries) {
    if (!key.startsWith(prefix)) continue;
    clearTimeout(entry.timer);
    gapRetries.delete(key);
  }
  for (const key of voiceSendInFlight) {
    if (key.startsWith(prefix)) voiceSendInFlight.delete(key);
  }
}

module.exports = {
  configureInbound,
  clearInboundAccountRuntime,
  // Maps / sets
  messageBuffers,
  processingInFlight,
  lastReplyAt,
  lastAnsweredMsgId,
  pendingAfterInFlight,
  gapRetries,
  deferredDialogs,
  reengageInFlight,
  voiceSendInFlight,
  // consts
  MIN_REPLY_GAP_MS,
  AGGREGATE_WINDOW_MS,
  AGGREGATE_MAX_WAIT_MS,
  DEFER_CHANCE,
  DEFER_MIN_MS,
  DEFER_MAX_MS,
  DEFER_MIN_HISTORY,
  DEFER_INTERRUPT_DELAY_MS,
  MAX_INCOMING_VIDEO_BYTES,
  VIEW_ONCE_TTL_SECONDS,
  // keys / helpers
  bufferKey,
  voiceSendKey,
  downloadMediaWithRetry,
  messageHasSpoiler,
  extractPlainIncomingText,
  quotedTextOf,
  stripQuoteMarkers,
  withQuote,
  extractIncomingText,
  extractVideoFrameBuffers,
  handleIncomingMessage,
  flushMessageBuffer,
  flushAllDeferredNow,
  scheduleAfterthought,
  scheduleLaterTextReturn,
  flushDueTextPromises,
  fireOneLaterTextReturn,
  scheduleDeferredMediaReturn,
  fireOneDeferredMedia,
  flushDueDeferredMedia,
  scheduleReengage,
  scheduleGapRetry,
};
