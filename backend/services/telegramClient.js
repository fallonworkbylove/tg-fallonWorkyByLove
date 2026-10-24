const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
require('./relaxGramJsPing');
const { TelegramClient, Api } = require('telegram');
const { ConnectionTCPFull } = require('telegram/network');
const { StringSession } = require('telegram/sessions');

const execFileAsync = promisify(execFile);
// Лимит скачивания входящего видео (одноразовые тоже). Больше — только превью.
const MAX_INCOMING_VIDEO_BYTES = 28 * 1024 * 1024;
// Telegram view-once: ttl_seconds == 0x7FFFFFFF
const VIEW_ONCE_TTL_SECONDS = 0x7fffffff;

// ---------------------------------------------------------------------------
// Соединение через порт 443.
// GramJS при первом подключении жёстко использует порт 80 (useWSS запрещён с
// прокси). Многие SOCKS5-прокси блокируют исходящий порт 80, но пропускают 443.
// Этот подкласс принудительно подключается к Telegram по 443 — Telegram
// принимает TCP-full и на 443. Используется только когда задан прокси.
// ---------------------------------------------------------------------------
class ConnectionTCPFull443 extends ConnectionTCPFull {
  constructor(params) {
    super({ ...params, port: 443 });
  }
}
const { computeCheck } = require('telegram/Password');
const { NewMessage } = require('telegram/events');
const db = require('../db');
const {
  generateReply,
  describeImage,
  transcribeAudio,
  isRussianConversation,
  detectReplyLanguage,
  extractUserQuestions,
  describeOwnMedia,
  classifyOwnMediaLight,
  heJustGreeted,
} = require('./aiResponder');
const learningDb = require('./learningDb');
const ragExamples = require('./ragExamples');
const {
  findVoiceForText,
  findTextReplyForText,
  sendVoiceReply,
} = require('./voiceReplies');
const {
  getMediaItems,
  pickUnsentMedia,
  pickMediaByContext,
  sendMediaItem,
  pickCaption,
  mediaTag,
  clearMediaCache,
  expandMediaContextTokens,
  tokenizeMediaContext,
} = require('./mediaReplies');
const { isPhotoRecognitionDisabled } = require('./photoRecognitionSettings');
 const helpRequestNotifier = require('./helpRequestNotifier');
const timeStyle = require('./timeStyle');
const moodEngine = require('./moodEngine');
const memoryTriggers = require('./memoryTriggers');
const accountPersona = require('./accountPersona');
const objectionHandler = require('./objectionHandler');
const complimentEngine = require('./complimentEngine');
const humanExtra = require('./humanExtra');

// Сколько последних сообщений диалога передавать модели как контекст.
// Было 10 (всего 5 обменов) — бот забывал, о чём уже спрашивал, и мог
// переспросить то же самое буквально через пару сообщений. Увеличили до 30,
// чтобы модель видела заметно больше реальной истории разговора.
const HISTORY_LIMIT = 60;

// Защита от параллельных обработчиков: пока первое голосовое отправляется,
// повторное сообщение из того же диалога не должно запустить вторую отправку.
const voiceSendInFlight = new Set();
const accountLabels = new Map();
/** accountId → lowercase @username (из getMe), для dating outreach */
const accountUsernames = new Map();

function accountLabel(accountId) {
  return accountLabels.get(String(accountId)) || `ID ${accountId}`;
}

function accountKey(accountId) {
  const n = Number(accountId);
  return Number.isInteger(n) ? n : accountId;
}

async function cacheAccountLabel(client, accountId) {
  try {
    const me = await client.getMe();
    const name = [me.firstName, me.lastName].filter(Boolean).join(' ') || (me.username ? `@${me.username}` : '');
    accountLabels.set(String(accountId), [me.phone, name].filter(Boolean).join(' — ') || `ID ${accountId}`);
    if (me.username) {
      accountUsernames.set(String(accountId), String(me.username).toLowerCase());
    } else {
      accountUsernames.delete(String(accountId));
    }
  } catch {
    accountLabels.set(String(accountId), `ID ${accountId}`);
  }
}

/**
 * Находит активный MTProto-аккаунт по публичному @username (getMe).
 */
async function findActiveAccountIdByUsername(username) {
  const needle = String(username || '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
  if (!needle) return null;

  for (const [id, uname] of accountUsernames.entries()) {
    if (uname === needle) {
      const n = Number(id);
      return Number.isInteger(n) ? n : id;
    }
  }

  for (const [id, client] of activeClients.entries()) {
    try {
      const me = await client.getMe();
      const uname = me?.username ? String(me.username).toLowerCase() : '';
      if (uname) accountUsernames.set(String(id), uname);
      if (uname === needle) {
        const n = Number(id);
        return Number.isInteger(n) ? n : id;
      }
    } catch (_) {
      /* skip offline */
    }
  }
  return null;
}

function voiceSendKey(accountId, peerId, fileName) {
  return `${accountId}:${String(peerId)}:${fileName}`;
}

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

// ---------------------------------------------------------------------------
// ПРОКСИ (для обхода блокировки Telegram, напр. на серверах в РФ).
// Настраивается через .env. Можно указать НЕСКОЛЬКО прокси — система при
// подключении переберёт их по очереди и возьмёт первый рабочий (failover).
//
// Формат PROXY_LIST: записи через точку с запятой ";", поля внутри — через ":"
//   mtproxy:  mtproxy:IP:PORT:SECRET
//   socks5:   socks5:IP:PORT            или   socks5:IP:PORT:USER:PASS
//   URL:      socks5://USER:PASS@IP:PORT
//
// Пример:
//   PROXY_LIST=mtproxy:1.2.3.4:443:ee00aa...;socks5:9.9.9.9:1080:user:pass
//
// Два пула:
//   PROXY_LIST / PROXY_FILE           — повседневная работа аккаунтов (DC)
//   PROXY_LIST_LOGIN / PROXY_FILE_LOGIN / config/proxies-login.txt
//                                    — только sendCode / логин (резидентские)
// Если login-пул пуст — логин берёт обычный PROXY_LIST (как раньше).
//
// (Старый формат PROXY_TYPE/PROXY_IP/... тоже поддерживается как одна запись.)
// ---------------------------------------------------------------------------
// GramJS поддерживает только «базовый» MTProxy-секрет: ровно 16 байт (32 hex).
// Публичные прокси часто дают секрет с префиксом:
//   dd + 32 hex       -> padded (random padding), префикс можно срезать;
//   ee + 32 hex + ... -> FakeTLS, GramJS НЕ поддерживает.
// Функция приводит секрет к 32 hex или возвращает null (прокси пропускается).
function normalizeMtSecret(rawSecret, label) {
  if (!rawSecret) {
    console.warn(`[proxy] MTProxy ${label}: секрет отсутствует — пропущен.`);
    return null;
  }

  let s = rawSecret.trim().toLowerCase();

  // Уже базовый 32-символьный hex.
  if (/^[0-9a-f]{32}$/.test(s)) return s;

  // padded: dd + 32 hex -> срезаем dd.
  if (/^dd[0-9a-f]{32}$/.test(s)) return s.slice(2);

  // FakeTLS: ee + ... — GramJS не умеет, пропускаем.
  if (s.startsWith('ee')) {
    console.warn(`[proxy] MTProxy ${label}: секрет FakeTLS (ee...) не поддерживается GramJS — пропущен. Нужен базовый или dd-секрет, либо SOCKS5.`);
    return null;
  }

  console.warn(`[proxy] MTProxy ${label}: неподдерживаемый формат секрета — пропущен.`);
  return null;
}

function parseProxyEntry(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  // socks5://user:pass@host:port  или  socks://user:pass@host:port
  const urlMatch = trimmed.match(
    /^(socks5?|SOCKS5?):\/\/(?:([^:@/?#]+):([^@/?#]*)@)?([^:/?#]+):(\d+)\/?$/i,
  );
  if (urlMatch) {
    const [, , user, pass, ip, port] = urlMatch;
    const proxy = { ip, port: Number(port), socksType: 5, timeout: 15 };
    if (user) proxy.username = decodeURIComponent(user);
    if (pass) proxy.password = decodeURIComponent(pass);
    return proxy;
  }

  const parts = trimmed.split(':').map((s) => s.trim());
  const type = (parts[0] || '').toLowerCase();

  if (type === 'mtproxy') {
    const [, ip, port, rawSecret] = parts;
    if (!ip || !port) return null;

    const secret = normalizeMtSecret(rawSecret, `${ip}:${port}`);
    if (!secret) return null; // секрет не поддерживается — пропускаем прокси

    return { ip, port: Number(port), MTProxy: true, secret, timeout: 15 };
  }

  if (type === 'socks5' || type === 'socks') {
    const [, ip, port, user, pass] = parts;
    if (!ip || !port) return null;
    const proxy = { ip, port: Number(port), socksType: 5, timeout: 15 };
    if (user) proxy.username = user;
    if (pass) proxy.password = pass;
    return proxy;
  }

  console.warn(`[proxy] Неизвестный тип прокси в записи "${raw}" — пропущена.`);
  return null;
}

// Файловый способ задать список прокси — удобен, когда прокси часто меняются
// или их список большой (не нужно перезаписывать .env и перезапускать env
// вручную каждый раз, достаточно поправить файл и перезапустить процесс).
// Путь можно переопределить в .env через PROXY_FILE, по умолчанию:
//   backend/config/proxies.txt
// Формат файла — одна запись прокси на строку, тот же синтаксис, что и в
// PROXY_LIST (без "точки с запятой" — разделитель здесь просто перевод строки):
//   mtproxy:1.2.3.4:443:ee00aa...
//   socks5:9.9.9.9:1080:user:pass
// Строки, начинающиеся с "#", и пустые строки игнорируются (можно комментировать).
const DEFAULT_PROXY_FILE = path.join(__dirname, '..', 'config', 'proxies.txt');
const DEFAULT_LOGIN_PROXY_FILE = path.join(__dirname, '..', 'config', 'proxies-login.txt');

function readProxyFile(filePath, label = 'proxy') {
  if (!filePath || !fs.existsSync(filePath)) return [];

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.warn(`[proxy] Не удалось прочитать файл ${label} ${filePath}: ${err.message}`);
    return [];
  }

  const entries = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  if (entries.length) {
    console.log(`[proxy] Файл ${filePath}: найдено ${entries.length} записей.`);
  }
  return entries;
}

function buildProxyPoolFromList(listRaw, fileEntries = [], { includeLegacy = false } = {}) {
  const pool = [];

  if (listRaw) {
    for (const raw of String(listRaw).split(/[;\n\r]+/)) {
      const entry = raw.trim();
      if (!entry) continue;
      const parsed = parseProxyEntry(entry);
      if (parsed) pool.push(parsed);
    }
  }

  for (const entry of fileEntries) {
    const parsed = parseProxyEntry(entry);
    if (parsed) pool.push(parsed);
  }

  if (includeLegacy) {
    const legacyType = (process.env.PROXY_TYPE || '').toLowerCase().trim();
    if (legacyType && process.env.PROXY_IP && process.env.PROXY_PORT) {
      const fields = [
        legacyType,
        process.env.PROXY_IP,
        process.env.PROXY_PORT,
        legacyType === 'mtproxy' ? process.env.PROXY_SECRET : process.env.PROXY_USER,
        legacyType === 'mtproxy' ? undefined : process.env.PROXY_PASS,
      ].filter((v) => v !== undefined && v !== '');
      const parsed = parseProxyEntry(fields.join(':'));
      if (parsed) pool.push(parsed);
    }
  }

  return pool;
}

const workProxyFile = process.env.PROXY_FILE
  ? path.resolve(process.env.PROXY_FILE)
  : DEFAULT_PROXY_FILE;
const loginProxyFile = process.env.PROXY_FILE_LOGIN
  ? path.resolve(process.env.PROXY_FILE_LOGIN)
  : DEFAULT_LOGIN_PROXY_FILE;

// Повседневная работа аккаунтов (DC).
const PROXY_POOL = buildProxyPoolFromList(process.env.PROXY_LIST, readProxyFile(workProxyFile, 'work'), {
  includeLegacy: true,
});

// Только логин / sendCode (резидентские). Пустой = fallback на PROXY_POOL.
const LOGIN_PROXY_POOL = buildProxyPoolFromList(
  process.env.PROXY_LIST_LOGIN,
  readProxyFile(loginProxyFile, 'login'),
);

// Индекс текущего рабочего прокси (только для PROXY_POOL / аккаунтов).
let currentProxyIndex = 0;

function proxyLabel(p) {
  return `${p.MTProxy ? 'mtproxy' : 'socks5'} ${p.ip}:${p.port}`;
}

function poolCandidates(pool, startIndex, extra = {}) {
  const base = { connectionRetries: 2, ...extra };
  if (!pool.length) return [base];

  const ordered = [];
  const start = ((Number(startIndex) || 0) % pool.length + pool.length) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const idx = (start + i) % pool.length;
    ordered.push({
      opts: { ...base, proxy: pool[idx], connection: ConnectionTCPFull443 },
      index: idx,
      pool,
    });
  }
  return ordered;
}

// Work/DC only. Все activeClients (и их downloadMedia/sendFile ГС/фото/видео)
// поднимаются через этот пул. LOGIN_PROXY_POOL сюда НЕ подмешивать.
function connectionCandidates(extra = {}) {
  return poolCandidates(PROXY_POOL, currentProxyIndex, extra);
}

/**
 * Только startLogin / sendCode.
 * Не вызывать из activateAccount и медиа-путей — иначе residential сожрёт ГБ на фото.
 */
function loginConnectionCandidates(extra = {}) {
  const pool = LOGIN_PROXY_POOL.length ? LOGIN_PROXY_POOL : PROXY_POOL;
  const candidates = poolCandidates(
    pool,
    Math.floor(Math.random() * Math.max(pool.length, 1)),
    extra,
  );
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = tmp;
  }
  return candidates;
}

// Одиночный набор опций (для интерактивного входа — берём текущий прокси).
function clientOptions(extra = {}) {
  const opts = { connectionRetries: 2, ...extra };
  if (PROXY_POOL.length > 0) {
    opts.proxy = PROXY_POOL[currentProxyIndex];
    // Через прокси — порт 443 (порт 80 часто заблокирован у SOCKS5-провайдеров).
    opts.connection = ConnectionTCPFull443;
  }
  return opts;
}

if (PROXY_POOL.length > 0) {
  console.log(
    `[proxy] Work (DC) пул: ${PROXY_POOL.length} — ${PROXY_POOL.map(proxyLabel).join(', ')}`,
  );
} else {
  console.log('[proxy] Work-прокси не заданы — прямое подключение к Telegram.');
}

if (LOGIN_PROXY_POOL.length > 0) {
  console.log(
    `[proxy] Login (residential) пул: ${LOGIN_PROXY_POOL.length} — ${LOGIN_PROXY_POOL.map(proxyLabel).join(', ')}`,
  );
} else {
  console.log('[proxy] Login-пул пуст — sendCode идёт через work/DC пул.');
}

// Клиенты ���������������� процессе входа. Ключ: `${userId}:${phone}`
const pendingLogins = new Map();

// Пул активных (рабочих) ��лиентов. Ключ: accountId, значение: TelegramClient
const activeClients = new Map();

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
  const MIN_REPLY_GAP_MS = 10000;

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
const AGGREGATE_WINDOW_MS = 1800;

// Максимальное общее время накопления серии (мс). Даже если собеседник
// продолжает печатать без остановки, после этого лимита бот всё равно ответит.
const AGGREGATE_MAX_WAIT_MS = 9000;

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

// ---------------------------------------------------------------------------
// РАБОЧИЕ ЧАСЫ / РЕЖИМ ДНЯ.
// Глобальный запасной диапазон 09:00–23:00 по Москве (WORK_* в .env).
// Если передан accountId — отвечает с подъёма до сна из режима дня
// (например до 01:34), а не обрывается ровно в 23:00.
// Вне бодрствования бот НЕ отвечает; входящие дочитываются после подъёма.
// ---------------------------------------------------------------------------
const WORK_START_HOUR = Number.parseInt(process.env.WORK_START_HOUR, 10) || 9;
const WORK_END_HOUR = Number.parseInt(process.env.WORK_END_HOUR, 10) || 23;
const WORK_TIMEZONE = process.env.WORK_TIMEZONE || 'Europe/Moscow';

// Текущий час (0–23) в заданном часовом поясе, независимо от пояса сервера.
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
    // Некорректный часовой пояс — запасной вариант: МСК = UTC+3.
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
    const life = ensureDailyLife(accountId);
    const { minutes } = moscowClock();
    const wake = Number(life.wakeMin) || WORK_START_HOUR * 60;
    const sleep = Number(life.sleepMin) || WORK_END_HOUR * 60;

    if (sleep < 24 * 60) {
      // Сон в тот же календарный день: бодрствует [подъём, сон).
      return minutes >= wake && minutes < sleep;
    }

    // Сон после полуночи (напр. 01:34): бодрствует с подъёма до сна,
    // включая вечер и кусок ночи до sleepToday.
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
 * Пока она ещё не «легла» по своему сну — не подсовываем «ты спишь».
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

// Отдельное окно NFT-кампании: 16:00–21:00 по Москве.
function isWithinNftCampaignHours() {
  const hour = getWorkZoneHour();
  return hour >= 16 && hour < 21;
}

function bufferKey(accountId, peerId) {
  return `${accountId}:${peerId}`;
}

/**
 * Снимает pending login (wizard TTL / отмена). Без ошибки, если сессии нет.
 */
async function cancelPendingLogin(userId, phone) {
  const key = loginKey(userId, phone);
  const entry = pendingLogins.get(key);
  if (!entry) return false;
  pendingLogins.delete(key);
  if (entry.client) {
    try {
      await entry.client.disconnect();
    } catch (_) {}
  }
  return true;
}

/** Все pending-логины этого telegram userId (на случай TTL без сохранённого phone). */
async function cancelAllPendingLoginsForUser(userId) {
  const prefix = `${userId}:`;
  const keys = [...pendingLogins.keys()].filter((k) => String(k).startsWith(prefix));
  for (const key of keys) {
    const entry = pendingLogins.get(key);
    pendingLogins.delete(key);
    if (entry?.client) {
      try {
        await entry.client.disconnect();
      } catch (_) {}
    }
  }
  return keys.length;
}

function loginKey(userId, phone) {
  return `${userId}:${phone}`;
}

// ---------------------------------------------------------------------------
// ВХОД (многошаговый): телефон -> код -> (пароль 2FA) -> session_string
// ---------------------------------------------------------------------------

/**
 * Ш��г 1: создаём клиент и просим Telegram отправить код.
 */
async function startLogin(userId, phone) {
  const key = loginKey(userId, phone);
  const previous = pendingLogins.get(key);
  if (previous?.client) {
    try {
      await previous.client.disconnect();
    } catch (_) {}
    pendingLogins.delete(key);
  }

  const loginPool = LOGIN_PROXY_POOL.length ? LOGIN_PROXY_POOL : PROXY_POOL;
  const loginPoolKind = LOGIN_PROXY_POOL.length ? 'residential' : 'work/DC-fallback';
  console.log(
    `[login] запрос кода для ${phone}, api_id=${apiId}, пул=${loginPoolKind} (${loginPool.length})`,
  );

  // Логин: отдельный residential-пул (если задан), иначе DC. Перемешан, без
  // сдвига currentProxyIndex — рабочие аккаунты остаются на своих DC IP.
  const candidates = loginConnectionCandidates({ connectionRetries: 1, timeout: 12 });
  let lastErr = null;

  for (const candidate of candidates) {
    const opts = candidate.opts || candidate;
    const index = candidate.index;
    const pool = candidate.pool || loginPool;
    let client;
    try {
      client = new TelegramClient(new StringSession(''), apiId, apiHash, opts);
      await client.connect();
      // Без forceSMS: иначе GramJS делает ResendCode и часто ловит SEND_CODE_UNAVAILABLE,
      // хотя первый код уже ушёл в приложение — кнопка «висит», хеш теряется.
      const sent = await client.sendCode({ apiId, apiHash }, phone, false);
      const phoneCodeHash = sent.phoneCodeHash;
      const isCodeViaApp = !!sent.isCodeViaApp;
      const typeName = sent.type?.className || sent.type?.constructor?.name || '';
      const nextName =
        sent.nextType?.className || sent.nextType?.constructor?.name || '';

      pendingLogins.set(key, { client, phoneCodeHash, phone });
      console.log(
        `[login] код запрошен для ${phone}` +
          (index !== undefined && pool[index] ? ` через ${proxyLabel(pool[index])}` : '') +
          ` [${loginPoolKind}]` +
          ` — доставка: ${isCodeViaApp ? 'приложение Telegram' : 'SMS/звонок'}` +
          (typeName ? ` type=${typeName}` : '') +
          (nextName ? ` next=${nextName}` : ''),
      );
      return { sent: true, isCodeViaApp, type: typeName, nextType: nextName };
    } catch (err) {
      lastErr = err;
      const via =
        index !== undefined && pool[index] ? ` через ${proxyLabel(pool[index])}` : '';
      console.error(
        `[login] sendCode не удался${via}:`,
        err.errorMessage || err.message,
      );
      try {
        if (client) await client.disconnect();
      } catch (_) {}
      const msg = `${err.errorMessage || ''} ${err.message || ''}`;
      // Это ошибки Telegram по номеру/лимиту — другие прокси не помогут.
      if (
        /FLOOD_WAIT|FLOOD|SEND_CODE_UNAVAILABLE|PHONE_NUMBER_INVALID|PHONE_NUMBER_BANNED|API_ID_INVALID/i.test(
          msg,
        )
      ) {
        throw err;
      }
    }
  }

  throw lastErr || new Error('Не удалось подключиться к Telegram для отправки кода');
}

/**
 * Повторная отправка кода (часто переключает с приложения на SMS/звонок).
 * Нужна живая pending-сессия после startLogin.
 */
async function resendLoginCode(userId, phone) {
  const key = loginKey(userId, phone);
  const entry = pendingLogins.get(key);
  if (!entry?.client || !entry.phoneCodeHash) {
    const err = new Error('Сессия входа не найдена. Запроси код заново.');
    err.statusCode = 400;
    throw err;
  }

  console.log(`[login] ResendCode для ${phone}`);
  try {
    const sent = await entry.client.invoke(
      new Api.auth.ResendCode({
        phoneNumber: phone,
        phoneCodeHash: entry.phoneCodeHash,
      }),
    );
    const phoneCodeHash = sent.phoneCodeHash || entry.phoneCodeHash;
    const typeName = sent.type?.className || sent.type?.constructor?.name || '';
    const isCodeViaApp = /App|SentCodeTypeApp/i.test(typeName) || !!sent.isCodeViaApp;
    pendingLogins.set(key, { ...entry, phoneCodeHash, phone });
    console.log(
      `[login] ResendCode ок для ${phone} — тип: ${typeName || 'unknown'}` +
        ` (${isCodeViaApp ? 'приложение' : 'SMS/звонок/другое'})`,
    );
    return {
      sent: true,
      isCodeViaApp,
      type: typeName,
    };
  } catch (err) {
    console.error(`[login] ResendCode не удался для ${phone}:`, err.errorMessage || err.message);
    throw err;
  }
}

/**
 * Шаг 2: отправляем код.
 * Возвращает { status: 'ok', sessionString } либо { status: 'needPassword' }.
 */
async function confirmCode(userId, phone, code) {
  const entry = pendingLogins.get(loginKey(userId, phone));
  if (!entry) throw new Error('Сессия входа не найдена. Начните заново.');

  const { client, phoneCodeHash } = entry;

  try {
    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash,
        phoneCode: code,
      }),
    );
  } catch (err) {
    if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      return { status: 'needPassword' };
    }
    throw err;
  }

  const sessionString = client.session.save();
  await client.disconnect();
  pendingLogins.delete(loginKey(userId, phone));

  return { status: 'ok', sessionString };
}

/**
 * Шаг 3 (если включена 2FA): отправляем облачный пароль.
 */
async function confirmPassword(userId, phone, password) {
  const entry = pendingLogins.get(loginKey(userId, phone));
  if (!entry) throw new Error('Сессия входа не найдена. Начните заново.');

  const { client } = entry;

  const passwordInfo = await client.invoke(new Api.account.GetPassword());
  const check = await computeCheck(passwordInfo, password);

  await client.invoke(new Api.auth.CheckPassword({ password: check }));

  const sessionString = client.session.save();
  await client.disconnect();
  pendingLogins.delete(loginKey(userId, phone));

  return { status: 'ok', sessionString };
}

// ---------------------------------------------------------------------------
// ПУЛ АКТИВНЫХ КЛИЕНТОВ (автоподъём сохранённых сессий)
// ---------------------------------------------------------------------------

/**
 * Поднимает клиент из сохранённой session_string и кладёт в пул.
 * Возвращает true при успехе, false при ошибке.
 */
async function activateAccount(accountId, sessionString) {
  accountId = accountKey(accountId);
  // Если уже активен — ничего не делаем
  if (activeClients.has(accountId)) return true;

  // Строго work/DC: медиа (ГС/фото/видео) пойдёт через этот клиент весь день.
  // Residential/login-пул здесь запрещён.
  const candidates = connectionCandidates();

  for (const candidate of candidates) {
    // candidate может быть либо {opts, index} (когда есть пул), либо plain opts.
    const opts = candidate.opts || candidate;
    const index = candidate.index;
    if (candidate.pool && candidate.pool !== PROXY_POOL) {
      console.error(
        `[proxy] BUG: activateAccount получил не work-пул — пропуск (защита residential)`,
      );
      continue;
    }

    let client;
    try {
      client = new TelegramClient(
        new StringSession(sessionString),
        apiId,
        apiHash,
        opts,
      );

      await client.connect();

      // Таймаут прокси не считаем удалением. Стираем запись только если
      // Telegram прямо говорит, что аккаунт или сессия больше не существуют.
      try {
        await client.getMe();
      } catch (authErr) {
        try { await client.disconnect(); } catch (_) {}
        if (isRevokedSessionError(authErr)) {
          await forgetRevokedAccount(accountId);
          return 'revoked';
        }
        console.error(
          `Не удалось проверить сессию аккаунта ${accountId}:`,
          authErr.errorMessage || authErr.message,
        );
        continue;
      }
      await cacheAccountLabel(client, accountId);

      // Успех. Если использовали прокси — запоминаем его как текущий рабочий.
      if (index !== undefined && index !== currentProxyIndex) {
        currentProxyIndex = index;
        console.log(`[proxy] Work: переключился на ${proxyLabel(PROXY_POOL[index])}`);
      }

      activeClients.set(accountId, client);

      client.addEventHandler(
        (event) => handleIncomingMessage(accountId, event),
        new NewMessage({ incoming: true }),
      );

      // Фоном дочитываем чаты, где собеседник писал до/пока мы были offline.
      // catchUp: больше лимит — чтобы не ограничиться первыми 8.
      scanUnansweredDialogs(accountId, 0, { catchUp: true }).catch((e) =>
        console.error(
          `[${accountLabel(accountId)}] Скан при активации не удался:`,
          e.message,
        ),
      );

      // Периодически перепроверяем непрочитанные (с фильтром возраста, чтобы
      // не конфликтовать с live-обработчиком свежих сообщений).
      if (!scanTimers.has(accountId)) {
        const timer = setInterval(() => {
          scanUnansweredDialogs(accountId, 90).catch(() => {});
        }, SCAN_INTERVAL_MS);
        // Не держим процесс живым из-за таймера.
        if (typeof timer.unref === 'function') timer.unref();
        scanTimers.set(accountId, timer);
      }

      // Следим за границей рабочих часов, чтобы слать «спокойной ночи» перед
      // ночью и ��доброе утро» утром. Первый тик просто запомнит текущее
      // состояние (без рассылки при рестарте среди дня/ночи).
      if (!boundaryTimers.has(accountId)) {
        workStateByAccount.set(accountId, timeStyle.getTimeStyle(getWorkZoneHour()).id);
        const bTimer = setInterval(
          () => checkWorkBoundary(accountId),
          BOUNDARY_CHECK_MS,
        );
        if (typeof bTimer.unref === 'function') bTimer.unref();
        boundaryTimers.set(accountId, bTimer);
      }

      return true;
    } catch (err) {
      const via = index !== undefined ? ` через ${proxyLabel(PROXY_POOL[index])}` : '';
      console.error(
        `Не удалось подключить аккаунт ${accountId}${via}:`,
        err.errorMessage || err.message,
      );
      // Закрываем не��дачный клиент и пробуем следующий прокси.
      try { if (client) await client.disconnect(); } catch (_) {}
      if (isRevokedSessionError(err)) {
        await forgetRevokedAccount(accountId);
        return 'revoked';
      }
    }
  }

  console.error(`Аккаунт ${accountId}: все прокси недо��тупны, ��одключение не удалось.`);
  return false;
}

function isRevokedSessionError(err) {
  const text = `${err?.errorMessage || ''} ${err?.message || ''}`;
  return /AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|PHONE_NUMBER_BANNED/.test(text);
}

async function forgetRevokedAccount(accountId) {
  try {
    const { purgeAccount } = require('./accountCleanup');
    const removed = await purgeAccount(accountId);
    console.log(
      removed
        ? `Аккаунт ${accountId}: сессия отозвана, запись удалена из базы.`
        : `Аккаунт ${accountId}: сессия отозвана, в базе записи уже нет.`,
    );
  } catch (err) {
    console.error(`Аккаунт ${accountId}: не удалось удалить отозванную сессию из базы:`, err.message);
  }
}

/**
 * Останавливает клиент и убирает из пула.
 */
async function deactivateAccount(accountId) {
  accountId = accountKey(accountId);
  // Останавливаем периодический скан непрочитанных диалогов.
  const timer = scanTimers.get(accountId);
  if (timer) {
    clearInterval(timer);
    scanTimers.delete(accountId);
  }

  // Останавливаем слежение за границей рабочих часов (приветствия).
  const bTimer = boundaryTimers.get(accountId);
  if (bTimer) {
    clearInterval(bTimer);
    boundaryTimers.delete(accountId);
  }
  workStateByAccount.delete(accountId);
  dailyLifeByAccount.delete(accountId);

  // Отменяем отложенные «паузы занятости» этого аккаунта, чтобы таймеры не
  // сработали после отключения.
  const prefix = `${accountId}:`;
  for (const [key, entry] of deferredDialogs) {
    if (key.startsWith(prefix)) {
      clearTimeout(entry.timer);
      deferredDialogs.delete(key);
    }
  }

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
  scanInFlight.delete(accountId);
  greetingInFlight.delete(accountId);

  const client = activeClients.get(accountId);
  activeClients.delete(accountId);
  if (!client) return;

  try {
    await client.disconnect();
  } catch (err) {
    console.error(`Ошибка отключения аккаунта ${accountId}:`, err.message);
  }
}

/**
 * Возвра����ает живой к��иент по accountId (или undefined).
 */
function getActiveClient(accountId) {
  return activeClients.get(accountKey(accountId));
}

/**
 * @username аккаунта (без @) из кэша или у живого клиента. Пусто, если нет.
 */
async function getAccountUsername(accountId) {
  const key = String(accountKey(accountId));
  if (accountUsernames.has(key)) return accountUsernames.get(key);
  const client = getActiveClient(accountId);
  if (!client) return '';
  try {
    const me = await client.getMe();
    const uname = me?.username ? String(me.username).toLowerCase() : '';
    if (uname) accountUsernames.set(key, uname);
    return uname;
  } catch (_) {
    return '';
  }
}

/**
 * Проверяет, активен ли аккаунт.
 */
function isActive(accountId) {
  return activeClients.has(accountKey(accountId));
}

// ---------------------------------------------------------------------------
// ОБРАБОТКА ВХОДЯЩИХ СООБЩЕНИЙ
// ---------------------------------------------------------------------------

/**
 * Возвращает данн��е аккаунта (промпт, флаг автоответчика и ��иа��аз��н
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

async function isPeerBlacklisted(accountId, peerId) {
  try {
    const [rows] = await db.execute(
      `SELECT b.id
       FROM blacklist b
       INNER JOIN accounts a ON a.user_id = b.user_id
       WHERE a.id = ? AND CAST(b.user_telegram_id AS CHAR) = ?
       LIMIT 1`,
      [accountId, String(peerId)],
    );
    return rows.length > 0;
  } catch (err) {
    console.error(`[${accountLabel(accountId)}] Не удалось проверить blacklist:`, err.message);
    return false;
  }
}

/** Пауза на указанное число миллисекунд. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Случайная пауза «подумала» (мс) из настроек аккаунта (reply_delay_min/max, 0..60с).
 * Это то, что крутится в боте/кабинете у аккаунта с ИИ — не перетираем.
 */
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

/**
 * Пауза перед отправкой: «подумала» из настроек аккаунта + набор.
 * alreadyTyping — уже пульсировали во время AI: всё равно держим reply_delay_*,
 * плюс короткий добор набора (не вместо настроек).
 */
function delayBeforeSendMs(settings, text, opts = {}) {
  const think = pickReplyDelayMs(settings);
  const typing = computeTypingMs(text, opts.accountId);
  if (opts.alreadyTyping) {
    return think + Math.min(1800, Math.max(300, Math.round(typing * 0.35)));
  }
  return think + typing;
}

function plainTextLen(text) {
  return String(text || '')
    .replace(/<<[^>]+>>/g, '')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/**
 * Сколько «смотрит» сообщение после галочек прочитано — от длины входящего.
 */
function computeReadDwellMs(incomingText) {
  const len = plainTextLen(incomingText);
  const openChat = 450 + Math.random() * 900;
  if (!len) return Math.round(openChat + 200 + Math.random() * 500);
  // Беглое чтение ~22–36 симв/сек; длинные — не читает каждую букву.
  const charsPerSec = 22 + Math.random() * 14;
  const readMs = Math.min(5500, (len / charsPerSec) * 1000);
  const thinkBit = Math.random() < 0.4 ? 350 + Math.random() * 1100 : 0;
  return Math.min(7500, Math.round(openChat + readMs * 0.55 + thinkBit));
}

/**
 * Длительность «печатает...» по длине ответа (набор с телефона).
 * Короткие — быстро; длинные — дольше, с редкими заминками.
 */
function computeTypingMs(text, accountId = null) {
  const len = plainTextLen(text);
  const pace = accountId != null ? humanExtra.getAccountPace(accountId) : null;
  const mul = pace?.typingMul || 1;
  let base;
  if (!len) base = 350 + Math.random() * 450;
  else if (len <= 6) base = 420 + Math.random() * 480;
  else if (len <= 18) base = 650 + Math.random() * 700 + len * 35;
  else {
    // Большой палец / RU: ~7–13 симв/сек в живом чате.
    const charsPerSec = 7.2 + Math.random() * 5.8;
    let typeMs = (len / charsPerSec) * 1000;
    const hesitations = Math.floor(len / (50 + Math.floor(Math.random() * 20)));
    for (let i = 0; i < hesitations; i += 1) {
      if (Math.random() < 0.6) typeMs += 280 + Math.random() * 780;
    }
    base = typeMs;
  }
  // Видимый typing не бесконечный — иначе палево на длинных ответах.
  return Math.min(9000, Math.max(600, Math.round(base * mul)));
}

/**
 * Пульс «печатает...» пока ждём AI / RAG — чтобы не было мёртвой тишины 10–30с.
 * Вернуть stop() когда генерация закончилась.
 */
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

/**
 * Выдерживает паузу перед ответом. «Печатает...» — только в конце,
 * длительность = typingMs (от длины ответа). До этого — тишина («читает/думает»).
 * Индикатор обновляем каждые ~3–4.5 с (Telegram сам гасит ~5 с).
 */
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
      // Индикатор печати не критичен.
    }

    // «Передумала» — сброс typing, потом снова (шанс выше у «медленных» аккаунтов).
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

/**
 * Живой порядок: прочитано → смотрит (от длины входящего) → думает → печатает (от длины ответа) → send.
 * Бюджет delayMs не раздуваем второй паузой: чтение входит в тихую фазу.
 */
async function humanPauseBeforeSend(
  client,
  peer,
  message,
  delayMs,
  typingMs,
  incomingText = '',
  accountId = null,
) {
  await markPeerAsRead(client, peer, message);

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
  // Чтение съедает часть «подумала», остаток — тишина перед typing.
  const dwell = Math.min(readDwellMs, Math.max(380, silentBudget + 600));
  await sleep(dwell);
  const remainingSilent = Math.max(0, silentBudget - dwell);
  if (accountId != null) {
    waitBeforeReply._rethinkChance = humanExtra.getAccountPace(accountId).rethinkChance;
  }
  await waitBeforeReply(client, peer, remainingSilent + typeMs, typeMs);
  waitBeforeReply._rethinkChance = undefined;
}

/**
 * Проверяет, лежит ли диалог с этим собеседником в АРХИВЕ.
 *
 * В Telegram архив — это системная папка с folder_id = 1. Мы запрашиваем
 * диалог конкретного собеседника и смотрим, в какой папке он находится.
 * Если в архивной (folderId === 1) — значит пользователь спрятал собеседника
 * и автоответчик отвечать ему не должен.
 *
 * Возвращает true, если диалог в архиве (нужно ПРОПУСТИТЬ ответ).
 * При ошибке access_hash/сети — fail-open (иначе глушим живые чаты).
 */
async function isPeerArchived(client, inputPeer) {
  try {
    // GetPeerDialogs ждёт InputPeer. Сырой User/entity без access_hash
    // часто даёт пустой ответ или диалог без folderId — из-за этого раньше
    // архивные чаты проходили проверку и получали silence/NFT.
    const peer = await client.getInputEntity(inputPeer);
    const result = await client.invoke(
      new Api.messages.GetPeerDialogs({
        peers: [new Api.InputDialogPeer({ peer })],
      }),
    );

    const dialog = result && result.dialogs && result.dialogs[0];
    if (!dialog) return false;
    // DialogFolder — служебная обёртка папки, не «этот peer в архиве».
    // Раньше return true → ложный вечный mute на живых чатах.
    if (dialog.className === 'DialogFolder') return false;

    // folderId === 1 / archived === true -> архив. undefined/0 -> основной список.
    if (dialog.archived === true) return true;
    return Number(dialog.folderId) === 1;
  } catch (err) {
    const code = String(err.errorMessage || err.message || '');
    console.warn(
      'Не удалось определить папку диалога — отвечаю (fail-open):',
      code,
    );
    return false;
  }
}

const PERMANENT_SEND_ERROR_CODES = [
  'CHAT_WRITE_FORBIDDEN',
  'USER_IS_BLOCKED',
  'USER_BANNED_IN_CHANNEL',
  'PEER_ID_INVALID',
  'USER_PRIVACY_RESTRICTED',
  'INPUT_USER_DEACTIVATED',
  'USER_DEACTIVATED',
  'USER_DEACTIVATED_BAN',
];

function isPermanentSendError(err) {
  const message = `${err && err.errorMessage ? err.errorMessage : ''} ${err && err.message ? err.message : ''}`;
  return PERMANENT_SEND_ERROR_CODES.some((code) => message.includes(code));
}

/**
 * Собеседник недоступен (блок, удалён, закрыл ЛС): в архив и больше не трогаем
 * silence / NFT / автоответ по этому peer.
 */
async function retireUnreachablePeer(client, accountId, peerId, entity, reason = 'unreachable') {
  const name =
    (entity && (entity.username || entity.firstName)) ||
    String(peerId);
  const why = String(reason || 'unreachable');

  if (client && entity) {
    try {
      await archivePeer(client, entity);
    } catch (err) {
      console.error(
        `[${accountLabel(accountId)}] Не удалось архивировать ${name} (${why}):`,
        err.errorMessage || err.message,
      );
    }
  }

  try {
    await helpRequestNotifier.disableAutoreplyForPeer(accountId, peerId, why);
  } catch (_) {}

  try {
    await claimWorkMention(accountId, peerId);
  } catch (_) {}

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

  console.log(
    `[${accountLabel(accountId)}] Диалог ${name} снят с рассылок (${why}).`,
  );
}

async function shouldSkipProactivePeer(client, entity) {
  if (!entity || entity.bot || entity.self || isDeletedUser(entity) || isNeverContact(entity)) {
    return true;
  }
  return isPeerArchived(client, entity);
}

function isNeverContact(entityOrUsername) {
  const raw = typeof entityOrUsername === 'string'
    ? entityOrUsername
    : entityOrUsername && entityOrUsername.username;
  const name = String(raw || '').replace(/^@/, '').trim().toLowerCase();
  return name === 'telegram';
}

function isDeletedUser(entity) {
  if (!entity) return false;
  if (entity.deleted || entity.className === 'UserEmpty') return true;
  const name = [entity.firstName, entity.lastName].filter(Boolean).join(' ').trim().toLowerCase();
  return name === 'deleted account' || name === 'удалённый аккаунт' || name === 'удаленный аккаунт';
}

function isServiceMessage(message) {
  return !!(message && (message.action || message.className === 'MessageService'));
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
  // .message — сырой текст (со спойлерами). .text иногда зависит от parseMode.
  if (message.message != null && String(message.message).length) return String(message.message);
  if (message.text != null && String(message.text).length) return String(message.text);
  return '';
}

/**
 * Триггер-сообщение ещё живо в чате? После «удалить у двоих» getMessages
 * отдаёт MessageEmpty / пусто — тогда отложенный ответ слать нельзя.
 */
async function isTriggerMessageAlive(client, peer, messageId) {
  if (!client || !peer || messageId == null) return true;
  const id = Number(messageId);
  if (!Number.isFinite(id) || id <= 0) return true;
  try {
    const rows = await client.getMessages(peer, { ids: [id] });
    const m = Array.isArray(rows) ? rows[0] : rows;
    if (!m) return false;
    const cls = String(m.className || '');
    if (cls === 'MessageEmpty' || cls === 'MessageService') return false;
    if (m.deleted) return false;
    // Пустышка без текста/медиа — история снесена.
    if (!m.message && !m.media && !m.action) return false;
    return true;
  } catch (err) {
    const msg = `${err && err.errorMessage ? err.errorMessage : ''} ${err && err.message ? err.message : ''}`;
    if (/MESSAGE_ID_INVALID|PEER_ID_INVALID|CHAT_ID_INVALID|CHANNEL_PRIVATE|USER_IS_BLOCKED|INPUT_USER_DEACTIVATED/i.test(msg)) {
      return false;
    }
    // Сетевой сбой — не глушим ответ.
    return true;
  }
}

async function cancelReplyIfDialogGone(client, accountId, peer, senderName, message, where = '') {
  const msgId = message?.id != null ? Number(message.id) : null;
  const alive = await isTriggerMessageAlive(client, peer, msgId);
  if (alive) return false;
  console.log(
    `[${accountLabel(accountId)}] ${senderName}: диалог/сообщение удалены` +
      (where ? ` (${where})` : '') +
      ' — ответ не отправляю.',
  );
  return true;
}

/**
 * Достаёт последние сообщения диалога (в хронологическом порядке).
 */
async function getHistory(accountId, peerId) {
  // mysql2 не принимает LIMIT ? — HISTORY_LIMIT вшиваем числом.
  const limit = Number(HISTORY_LIMIT) || 20;
  // Берём с запасом по времени, чтобы отрезать сессию после паузы ≥72ч.
  const [rows] = await db.execute(
    `SELECT role, content, created_at FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?
     ORDER BY id DESC
     LIMIT ${Math.max(limit * 3, 60)}`,
    [accountId, peerId],
  );
  const chronological = rows.reverse();
  return filterHistoryToCurrentSession(chronological, limit);
}

/**
 * Как человек: после паузы ≥72ч «забываем» старый диалог.
 * В промпт попадает только текущая сессия (после последнего большого гэпа).
 */
function filterHistoryToCurrentSession(rows, limit) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  let sessionStart = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = new Date(rows[i - 1].created_at).getTime();
    const cur = new Date(rows[i].created_at).getTime();
    if (!Number.isFinite(prev) || !Number.isFinite(cur)) continue;
    const gapHours = (cur - prev) / (60 * 60 * 1000);
    if (gapHours >= 72) sessionStart = i;
  }
  return rows.slice(sessionStart).slice(-limit).map((r) => ({
    role: r.role,
    content: r.content,
    created_at: r.created_at,
  }));
}

/** Сессия только что началась после ≥72ч паузы — модели нельзя ссылаться на «старое». */
function isFreshSessionAfterGap(history) {
  if (!Array.isArray(history) || history.length === 0) return false;
  // Если в урезанной истории мало сообщений и первое свежее — скорее новая сессия.
  return history.length <= 4;
}

/**
 * Эмоции по паузе: радость после долгого возврата, лёгкая обида если игнорил.
 * history — до текущего входящего (ещё не сохранено).
 */
function buildEmotionHint(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const last = history[history.length - 1];
  if (!last || !last.created_at) return null;
  const idleHours = (Date.now() - new Date(last.created_at).getTime()) / (60 * 60 * 1000);
  if (!Number.isFinite(idleHours) || idleHours < 0) return null;

  if (idleHours >= 18) {
    return (
      'ЭМОЦИЯ: он написал после долгого молчания (много часов/сутки+). ' +
      'Лёгкая радость что объявился — коротко и тепло («о живой)», «ну наконец)» и т.п.). ' +
      'БЕЗ допроса и без вопроса в конце обязательного.'
    );
  }
  if (idleHours >= 6 && last.role === 'assistant') {
    return (
      'ЭМОЦИЯ: ты писала, он долго не отвечал и вот объявился. Можно чуть задеть / сарказм ' +
      '(«ну надо же», «а я уж думала пропал)») — одно короткое предложение, без драмы и без эссе.'
    );
  }
  return null;
}

function buildSessionForgetHint(historyWasTrimmed) {
  if (!historyWasTrimmed) return null;
  return (
    'ПАМЯТЬ: это как будто новый заход в переписку после длинной паузы. ' +
    'НЕ ссылайся на старые темы/факты которых нет в истории выше. Общайся как с начала знакомства, тепло и коротко.'
  );
}


/**
 * Диалог на русском? Голосовые заготовки (русские ogg) не шлём англоязычным.
 */
async function conversationIsRussian(accountId, peerId, latestText = '') {
  try {
    const history = await getHistory(accountId, peerId);
    return isRussianConversation(latestText, history);
  } catch (_) {
    return isRussianConversation(latestText, []);
  }
}

/** Язык ответа для этого диалога: 'ru' | 'en' | 'de'. */
async function conversationReplyLang(accountId, peerId, latestText = '') {
  try {
    const history = await getHistory(accountId, peerId);
    return detectReplyLanguage(latestText, history);
  } catch (_) {
    return detectReplyLanguage(latestText, []);
  }
}

/**
 * Сох������аняет одно сообщение диалога в историю.
 */
async function saveMessage(accountId, peerId, peerUsername, role, content) {
  await db.execute(
    `INSERT INTO conversation_messages (account_id, peer_id, peer_username, role, content)
     VALUES (?, ?, ?, ?, ?)`,
    [accountId, peerId, peerUsername, role, content],
  );
}

/**
 * Формирует метку голосового сообщения д������я хранения в истории.
 * По ней мы понимаем, какая именно заготовка уже отправлялась собеседнику.
 */
function voiceTag(fileName) {
  return `[голосовое: ${fileName}]`;
}

/**
 * Проверяет, отправляли ли мы э��ому ��обеседнику ��ОНКРЕТНУЮ голосовую
 * заготовку раньше. Нужна, чтобы не слать одно и то же голосовое повторно
 * (например, если человек второй раз нап��сал «сво»).
 */
  async function wasVoiceSent(accountId, peerId, fileName) {
    const likeName = String(fileName).replace(/[\\%_]/g, '\\$&');
    const [rows] = await db.execute(
      `SELECT id FROM conversation_messages
       WHERE account_id = ? AND peer_id = ?
         AND (content = ? OR content LIKE ? ESCAPE '\\\\')
       LIMIT 1`,
      [accountId, peerId, voiceTag(fileName), `%: ${likeName}]`],
    );
    return rows.length > 0;
  }

  async function wasAnyVoiceSent(accountId, peerId) {
    // Голосовое «как проходит день» / тишина не считается — иначе после него
    // навсегда блокируются все триггерные войсы.
    const [rows] = await db.execute(
      `SELECT id FROM conversation_messages
       WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
       AND content LIKE '[голосовое:%'
       AND content NOT LIKE '%kak_prohodit_den%'
       AND content NOT LIKE '%как проходит%'
       LIMIT 1`,
      [accountId, peerId],
    );
    return rows.length > 0;
  }

  /**
   * Когда в последний раз уходило ЛЮБОЕ голосовое (включая «как проходит день»).
   * Нужно, чтобы два голосовых не улетали подряд: заготовка сразу после
   * авто-напоминания выглядит как спам.
   */
  async function lastAnyVoiceSentAt(accountId, peerId) {
    const [rows] = await db.execute(
      `SELECT created_at FROM conversation_messages
       WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
       AND content LIKE '[голосовое:%'
       ORDER BY id DESC LIMIT 1`,
      [accountId, peerId],
    );
    if (!rows.length) return null;
    const t = new Date(rows[0].created_at).getTime();
    return Number.isFinite(t) ? t : null;
  }

  /** Последнее входящее сообщение собеседника (для проверки «он попрощался»). */
  async function lastIncomingText(accountId, peerId) {
    const [rows] = await db.execute(
      `SELECT content FROM conversation_messages
       WHERE account_id = ? AND peer_id = ? AND role = 'user'
       ORDER BY id DESC LIMIT 1`,
      [accountId, peerId],
    );
    return rows.length ? String(rows[0].content || '') : '';
  }


// ---------------------------------------------------------------------------
// NFT-КАМПАНИЯ (3 дня): мягкие напоминания про заработок на NFT, а на 3-й день —
// голосовое nft.ogg с просьбой помочь с токеном.
//
// Почему это в коде, а не только в промпте: промпт статичен и не знает, сколько
// дней длится знакомство. День считаем от начала ТЕКУЩЕЙ сессии диалога
// (после паузы ≥72ч старые записи в БД не считаются «3-м днём») и передаём
// модели готовую подсказку. Без активного диалога (человек давно не писал)
// NFT-кампанию не ведём.
// ---------------------------------------------------------------------------

// Папка с готовыми голосовыми заготовками (poka.ogg, nft.ogg и т.д.).
const VOICES_DIR = path.join(__dirname, '..', 'voices');

// Имя файла голосового с просьбой помочь с NFT-токеном (кладётся в voices/).
const NFT_VOICE_FILE = 'nft.ogg';
let nftVoiceMissingLogged = false;
// Голосовое уходит, когда диалогу столько часов (3-й день знакомства).
// После отправки бот полностью замолкает на этом собеседнике.
// NFT-голосовое разрешено только с третьего дня общения.
// Первые 48 часов после старта ТЕКУЩЕЙ сессии диалога всегда исключены.
const NFT_VOICE_AFTER_HOURS = 48;
const NFT_VOICE_LEAD_MIN_MS = 60 * 60 * 1000;
const NFT_VOICE_LEAD_MAX_MS = 2 * 60 * 60 * 1000;
// Одно сообщение «проблему с работой решаю» примерно за 30 минут до голосового.
const NFT_WORK_MENTION_MIN_MS = 10 * 60 * 1000;
const NFT_WORK_MENTION_MAX_MS = 50 * 60 * 1000;
// Пауза без сообщений — старый диалог в БД считаем законченным, возраст с нуля.
const NFT_DIALOG_SESSION_GAP_HOURS = 72;
// Нет входящих от человека столько часов — активного диалога нет, NFT не ведём.
const NFT_ACTIVE_DIALOGUE_IDLE_HOURS = 72;
const WORK_PROBLEM_PHRASES_RU = [
  'минутку, по работе отвлекусь)',
  'щас чуть по работе)',
  'ой, работу гляну быстро)',
  'секунду, рабочее)',
];
const WORK_PROBLEM_PHRASES_EN = [
  'one sec, work thing)',
  'brb quick work stuff',
  'oops gotta check something for work)',
  'hold on, work)',
];

let nftScheduleReady = false;
const nftWorkMentionInFlight = new Set();
const nftVoiceTickInFlight = new Set();

function pickWorkProblemPhrase(isRussian = true) {
  const bank = isRussian ? WORK_PROBLEM_PHRASES_RU : WORK_PROBLEM_PHRASES_EN;
  return bank[Math.floor(Math.random() * bank.length)];
}

function withWorkProblemLine(text) {
  // Больше НЕ подмешиваем «по работе» в тот же ответ — это выглядело как
  // единственная «инициатива» NFT-кампании вместо живого ответа.
  return String(text || '').trim();
}

/** После нормального ответа — отдельным сообщением «секунду, рабочее)» если пора. */
async function maybeSendWorkAside(client, sender, accountId, peerId, senderName, enabled) {
  if (!enabled) return false;
  if (!(await claimWorkMention(accountId, peerId))) return false;
  const isRussian = await conversationIsRussian(accountId, peerId);
  const line = pickWorkProblemPhrase(isRussian);
  try {
    await sleep(2500 + Math.random() * 3500);
    await client.sendMessage(sender, { message: line });
    await saveMessage(accountId, peerId, senderName, 'assistant', line);
    console.log(
      `[${accountLabel(accountId)}] Отдельным сообщением «по работе» для ${senderName}: "${line}"`,
    );
    return true;
  } catch (err) {
    await releaseWorkMention(accountId, peerId).catch(() => {});
    console.error(
      `[${accountLabel(accountId)}] Не удалось отправить «по работе» ${senderName}:`,
      err.message,
    );
    return false;
  }
}

function shouldSuppressNftForTurn(
  text,
  { flipPhotoQuestion = false, explicitMediaRequest = false, history = null } = {},
) {
  if (flipPhotoQuestion || explicitMediaRequest) return true;
  if (objectionHandler.isAskingHerName(text)) return true;
  if (objectionHandler.isDirectQuestion(text)) return true;
  if (objectionHandler.isAboutHerJobQuestion(text)) return true;
  if (objectionHandler.isContactOrMeetRelated(text)) return true;
  // Ответ на «сколько на дв» / «какой?» после ДВ — NFT питч запрещён.
  if (history && isAnswerToHowLong(history)) return true;
  if (history && typeof objectionHandler.getDvClarifyHint === 'function') {
    if (objectionHandler.getDvClarifyHint(text, history)) return true;
  }
  if (history && typeof objectionHandler.getDvRareCorrectionHint === 'function') {
    if (objectionHandler.getDvRareCorrectionHint(text, history)) return true;
  }
  return false;
}

/** Если модель всё же ушла в NFT / «уже бывал» при ДВ-контексте — жёсткий безопасный ответ. */
function sanitizeReplyAgainstNftLeak(reply, objectionHint) {
  const hint = String(objectionHint || '');
  if (!hint) return reply;
  const dvGuard =
    /только про дв|про ДВ|НА дв|ЗАПРЕЩЕНО: NFT|ЗАПРЕЩЕНО: «ты уже в теме|КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО: NFT|КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО: «уже бывал/i.test(
      hint,
    );
  if (!dvGuard) return reply;
  const text = String(reply || '');
  const nftLeak = /нфт|\bnft\b|токен|флип|коллекц|платформ|крипт|whitelist|вайтлист/i.test(text);
  const veteranPush =
    /новичок|редко сидит|мало дней|редко на дв|не бывалый|КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО: «уже бывал/i.test(
      hint,
    ) && /уже\s+бывал|уже\s+шаришь|ну\s+ты\s+на\s+дв\s+уже|опытный\s+на\s+дв/i.test(text);
  if (!nftLeak && !veteranPush) return reply;
  if (/уточняет|какой\s*\//i.test(hint)) return 'ну про дв)';
  if (/редко на дв|не бывалый|поправляет/i.test(hint)) return 'ага поняла)';
  return 'поняла)';
}

function pickWorkMentionAt(scheduledAt) {
  const span = NFT_WORK_MENTION_MAX_MS - NFT_WORK_MENTION_MIN_MS;
  const before = NFT_WORK_MENTION_MIN_MS + Math.floor(Math.random() * (span + 1));
  return new Date(scheduledAt.getTime() - before);
}

function isWorkMentionWindow(scheduledAt, now = Date.now()) {
  const until = scheduledAt.getTime() - now;
  return until >= NFT_WORK_MENTION_MIN_MS && until <= NFT_WORK_MENTION_MAX_MS;
}

async function listUserDialogs(client, maxCount = 5000) {
  const dialogs = [];
  const pageSize = 100;
  let offsetId = 0;
  let offsetDate;
  let offsetPeer;

  for (let page = 0; page < Math.ceil(maxCount / pageSize); page += 1) {
    let batch;
    try {
      batch = await client.getDialogs({
        limit: pageSize,
        offsetId: offsetId || undefined,
        offsetDate,
        offsetPeer,
        ignorePinned: page > 0,
      });
    } catch (err) {
      if (!dialogs.length) throw err;
      return { dialogs, complete: false };
    }
    if (!batch?.length) return { dialogs, complete: true };

    dialogs.push(...batch);
    if (batch.length < pageSize) return { dialogs, complete: true };

    const last = batch[batch.length - 1];
    const nextId = last.message?.id || last.dialog?.topMessage || 0;
    const nextDate = last.message?.date || last.date;
    const nextPeer = last.inputEntity || last.entity;
    if (!nextId || nextId === offsetId) return { dialogs, complete: false };
    offsetId = nextId;
    offsetDate = nextDate;
    offsetPeer = nextPeer;
  }

  return { dialogs, complete: false };
}

function rememberArchiveFlags(dialogs, flags) {
  for (const dialog of dialogs) {
    if (!dialog.isUser || !dialog.entity || dialog.entity.bot || dialog.entity.self) continue;
    flags.set(String(dialog.entity.id), !!dialog.archived);
    flags.entities.set(String(dialog.entity.id), dialog.entity);
  }
}

// Полный обход диалогов — десятки GetDialogs; минутные джобы делят один снимок,
// иначе Telegram отвечает FLOOD_WAIT и тормозит обычные ответы.
const ARCHIVE_FLAGS_TTL_MS = 3 * 60 * 1000;
const archiveFlagsCache = new WeakMap();

async function loadArchiveFlags(client) {
  const cached = archiveFlagsCache.get(client);
  if (cached?.promise) return cached.promise;
  if (cached?.flags && Date.now() - cached.at < ARCHIVE_FLAGS_TTL_MS) return cached.flags;

  const promise = (async () => {
    const flags = new Map();
    flags.entities = new Map();
    const { dialogs, complete } = await listUserDialogs(client);
    rememberArchiveFlags(dialogs, flags);
    flags.complete = complete;
    flags.dialogs = dialogs;
    return flags;
  })();
  archiveFlagsCache.set(client, { ...cached, promise });
  try {
    const flags = await promise;
    archiveFlagsCache.set(client, { at: Date.now(), flags });
    return flags;
  } catch (err) {
    if (cached?.flags) archiveFlagsCache.set(client, { at: cached.at, flags: cached.flags });
    else archiveFlagsCache.delete(client);
    throw err;
  }
}

function markArchivedInCache(client, peer) {
  const flags = archiveFlagsCache.get(client)?.flags;
  const id = peer?.userId ?? peer?.id;
  if (flags && id != null) flags.set(String(id), true);
}

// Собеседник запретил голосовые в настройках приватности — больше не пробуем.
const voiceForbiddenPeers = new Set();

function isVoiceForbiddenError(err) {
  return /VOICE_MESSAGES_FORBIDDEN/.test(String(err?.errorMessage || err?.message || ''));
}

function isFloodError(err) {
  const text = String(err?.errorMessage || err?.message || '');
  return /FLOOD/i.test(text) || /A wait of \d+ seconds/i.test(text) || Number(err?.seconds) > 0;
}

function isHiddenFromReplies(flags, peerId) {
  const state = flags.get(String(peerId));
  if (state === true) return true;
  if (state === false) return false;
  // Нет в снимке: при неполном GetDialogs не считаем архивом (иначе NFT/work
  // молчат по живым чатам до TTL). Полный снимок без peer → спрятан/ушёл.
  if (flags && flags.complete === false) return false;
  return true;
}

/**
 * Ставит «прочитано» (две синие галочки у собеседника), если у обоих
 * включены уведомления о прочтении в настройках Telegram.
 */
async function markPeerAsRead(client, peer, message = null) {
  if (!client || !peer) return;
  // Жёсткий запрет: архивные диалоги никогда не читаем.
  try {
    if (await isPeerArchived(client, peer)) return;
  } catch (_) {
    return;
  }
  try {
    if (typeof client.markAsRead === 'function') {
      if (message) {
        await client.markAsRead(peer, message);
      } else {
        await client.markAsRead(peer);
      }
      return;
    }
    const inputPeer = await client.getInputEntity(peer);
    const maxId = message?.id ? Number(message.id) : 0;
    await client.invoke(
      new Api.messages.ReadHistory({
        peer: inputPeer,
        maxId,
      }),
    );
  } catch (err) {
    // Не валим ответ из‑за read receipt
    console.warn('[telegram] markAsRead failed:', err.errorMessage || err.message);
  }
}

async function peerHasIncoming(client, entity) {
  let offsetId = 0;
  for (let page = 0; page < 8; page += 1) {
    const messages = await client.getMessages(entity, {
      limit: 100,
      ...(offsetId ? { offsetId } : {}),
    });
    if (!messages?.length) return false;
    for (const message of messages) {
      if (!message || isServiceMessage(message)) continue;
      if (!message.out) return true;
    }
    const oldestId = messages[messages.length - 1]?.id;
    if (!oldestId || oldestId === offsetId || messages.length < 100) return false;
    offsetId = oldestId;
  }
  return false;
}

async function addNftScheduleColumn(name, definition) {
  try {
    await db.execute(`ALTER TABLE nft_voice_schedule ADD COLUMN ${name} ${definition}`);
  } catch (err) {
    if (err.errno !== 1060 && err.code !== 'ER_DUP_FIELDNAME') throw err;
  }
}

async function ensureNftScheduleTable() {
  if (nftScheduleReady) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nft_voice_schedule (
      account_id INT NOT NULL,
      peer_id VARCHAR(64) NOT NULL,
      scheduled_at DATETIME NOT NULL,
      work_mention_at DATETIME NULL,
      work_mention_sent TINYINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (account_id, peer_id)
    )
  `);
  await addNftScheduleColumn('work_mention_at', 'DATETIME NULL');
  await addNftScheduleColumn('work_mention_sent', 'TINYINT NOT NULL DEFAULT 0');
  nftScheduleReady = true;
}

async function claimWorkMention(accountId, peerId) {
  const [res] = await db.execute(
    `UPDATE nft_voice_schedule
     SET work_mention_sent = 1
     WHERE account_id = ? AND peer_id = ? AND work_mention_sent = 0`,
    [accountId, String(peerId)],
  );
  return res.affectedRows > 0;
}

async function postponeNftVoice(accountId, peerId, delayMs) {
  await db.execute(
    `UPDATE nft_voice_schedule SET scheduled_at = ?
     WHERE account_id = ? AND peer_id = ?`,
    [new Date(Date.now() + delayMs), accountId, String(peerId)],
  );
}

async function releaseWorkMention(accountId, peerId) {
  await db.execute(
    `UPDATE nft_voice_schedule SET work_mention_sent = 0
     WHERE account_id = ? AND peer_id = ?`,
    [accountId, String(peerId)],
  );
}

async function getOrCreateNftVoiceAt(accountId, peerId) {
  await ensureNftScheduleTable();
  const [[existing]] = await db.execute(
    `SELECT scheduled_at, work_mention_at, work_mention_sent
     FROM nft_voice_schedule
     WHERE account_id = ? AND peer_id = ? LIMIT 1`,
    [accountId, peerId],
  );
  if (existing?.scheduled_at) {
    const scheduledAt = new Date(existing.scheduled_at);
    let workMentionAt = existing.work_mention_at ? new Date(existing.work_mention_at) : null;
    if (!workMentionAt) {
      workMentionAt = pickWorkMentionAt(scheduledAt);
      await db.execute(
        `UPDATE nft_voice_schedule SET work_mention_at = ?
         WHERE account_id = ? AND peer_id = ? AND work_mention_at IS NULL`,
        [workMentionAt, accountId, String(peerId)],
      );
    }
    return {
      scheduledAt,
      workMentionAt,
      workMentionSent: Number(existing.work_mention_sent) === 1,
    };
  }

  const delay = NFT_VOICE_LEAD_MIN_MS
    + Math.floor(Math.random() * (NFT_VOICE_LEAD_MAX_MS - NFT_VOICE_LEAD_MIN_MS + 1));
  const scheduledAt = new Date(Date.now() + delay);
  const workMentionAt = pickWorkMentionAt(scheduledAt);
  await db.execute(
    `INSERT INTO nft_voice_schedule
       (account_id, peer_id, scheduled_at, work_mention_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE scheduled_at = scheduled_at`,
    [accountId, String(peerId), scheduledAt, workMentionAt],
  );
  const [[row]] = await db.execute(
    `SELECT scheduled_at, work_mention_at, work_mention_sent
     FROM nft_voice_schedule
     WHERE account_id = ? AND peer_id = ? LIMIT 1`,
    [accountId, peerId],
  );
  return {
    scheduledAt: new Date(row.scheduled_at),
    workMentionAt: row.work_mention_at ? new Date(row.work_mention_at) : workMentionAt,
    workMentionSent: Number(row?.work_mention_sent) === 1,
  };
}

/**
 * Возвращает, сколько часов прошло с первого сообщения диалога.
 * null — если истории ещё нет или колонка недоступна (кампания просто выключится).
 */
async function getDialogTail(accountId, peerId) {
  const [rows] = await db.execute(
    `SELECT role, content FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?
     ORDER BY id DESC
     LIMIT 30`,
    [accountId, String(peerId)],
  );
  const hasIncoming = rows.some((row) => row.role === 'user');
  const lastRole = rows[0]?.role || null;
  return { hasIncoming, lastRole };
}

// Сообщение бота, ушедшее позже этого после предыдущего, — не ответ, а инициатива.
const PROACTIVE_GAP_MS = 60 * 60 * 1000;
// NFT-шаги сами по себе шлём только в живой диалог: он писал совсем недавно.
const NFT_LIVE_DIALOG_MIN = 30;
const NFT_VOICE_LIVE_DIALOG_MIN = 60;

/** Минут с последнего входящего от человека (null — входящих нет). */
async function lastIncomingAgeMin(accountId, peerId) {
  const [[row]] = await db.execute(
    `SELECT TIMESTAMPDIFF(SECOND, MAX(created_at), NOW()) AS age_sec
     FROM conversation_messages
     WHERE account_id = ? AND peer_id = ? AND role = 'user'`,
    [accountId, String(peerId)],
  );
  if (!row || row.age_sec == null) return null;
  return Number(row.age_sec) / 60;
}

/**
 * Уже висит наша инициатива без ответа (приветствие, пинг, голосовое) —
 * вторую не шлём, пока он не напишет. Иначе выходит «спокойной» → «доброе утро»
 * → «спокойной» в пустоту.
 */
async function hasUnansweredProactive(accountId, peerId) {
  const [rows] = await db.execute(
    `SELECT role, created_at FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?
     ORDER BY id DESC
     LIMIT 20`,
    [accountId, String(peerId)],
  );
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].role === 'user') return false;
    const prev = rows[i + 1];
    if (!prev) return true;
    const gap = new Date(rows[i].created_at).getTime() - new Date(prev.created_at).getTime();
    if (gap > PROACTIVE_GAP_MS) return true;
  }
  return rows.length > 0;
}

/**
 * Возвращает, сколько часов прошло с начала ТЕКУЩЕЙ сессии диалога.
 * null — если истории нет ИЛИ сейчас нет активного диалога (человек давно не писал).
 *
 * Важно: старые сообщения в БД после длинной паузы не считаются «3-м днём».
 * Сессия сбрасывается, если между сообщениями пауза ≥ NFT_DIALOG_SESSION_GAP_HOURS.
 */
async function getDialogAgeHours(accountId, peerId) {
  try {
    const [rows] = await db.execute(
      `SELECT role, created_at FROM conversation_messages
       WHERE account_id = ? AND peer_id = ?
       ORDER BY created_at ASC, id ASC`,
      [accountId, peerId],
    );
    if (!rows.length) return null;

    let lastUserAt = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].role === 'user') {
        lastUserAt = new Date(rows[i].created_at);
        break;
      }
    }
    // В БД человек есть, но входящих нет / давно молчит — диалога нет, NFT не кидаем.
    if (!lastUserAt) return null;
    const idleHours = (Date.now() - lastUserAt.getTime()) / (60 * 60 * 1000);
    if (idleHours > NFT_ACTIVE_DIALOGUE_IDLE_HOURS) return null;

    let sessionStart = new Date(rows[0].created_at);
    for (let i = 1; i < rows.length; i++) {
      const prev = new Date(rows[i - 1].created_at).getTime();
      const cur = new Date(rows[i].created_at).getTime();
      const gapHours = (cur - prev) / (60 * 60 * 1000);
      if (gapHours >= NFT_DIALOG_SESSION_GAP_HOURS) {
        sessionStart = new Date(rows[i].created_at);
      }
    }

    return (Date.now() - sessionStart.getTime()) / (60 * 60 * 1000);
  } catch (err) {
    console.error(
      `[${accountLabel(accountId)}] Не смог посчитать возраст диалога (NFT-кампания выключена):`,
      err.message,
    );
    return null;
  }
}

/**
 * Упоминала ли бот NFT/флиппинг этому собеседнику за последние сутки.
 * Нужно, чтобы напоминание было раз в день, а не в каждом сообщении.
 */
async function nftMentionedRecently(accountId, peerId) {
  try {
    const [rows] = await db.execute(
      `SELECT id FROM conversation_messages
       WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
         AND created_at > (NOW() - INTERVAL 36 HOUR)
         AND (content LIKE '%нфт%' OR content LIKE '%nft%'
              OR content LIKE '%флип%' OR content LIKE '%токен%')
       LIMIT 1`,
      [accountId, peerId],
    );
    return rows.length > 0;
  } catch (err) {
    console.error(
      `[${accountLabel(accountId)}] Не смог проверить упоминания NFT:`,
      err.message,
    );
    // Ошибку трактуем как «уже упоминала» — лучше промолчать, чем спамить.
    return true;
  }
}

/**
 * Считает состояние NFT-кампании для конкретного собеседника.
 *
 * @returns {Promise<{hint: string|null, sendVoice: boolean}>}
 *   hint — доп. инструкция для модели на этот ответ (или null);
 *   sendVoice — пора отправить голосовое nft.ogg.
 */
async function getNftCampaignState(accountId, peerId, historyLength) {
  // NFT-кампания работает только днём и вечером по московскому времени:
  // 16:00 включительно — 21:00 не включительно. В остальное время не создаём
  // ни текстовых напоминаний, ни NFT-голосовых.
  if (!isWithinNftCampaignHours()) {
    return { hint: null, sendVoice: false };
  }

  const ageHours = await getDialogAgeHours(accountId, peerId);
  // Нет истории/даты — кампанию не ведём. Сначала нормальное знакомство:
  // не лезем с NFT в первые реплики (иначе отталкивает).
  if (ageHours == null || historyLength < 14) return { hint: null, sendVoice: false };

  // С третьего дня: пора просить помощи с токеном голосовым. В первые два дня
  // NFT-голосовое не отправляется. После отправки
  // голосового бот полностью замолкает на этом собеседнике (автоответ
  // отключается через disableAutoreplyForPeer) и оператору приходит
  // уведомление о том, что голосовое отправлено — дальше ведёт живой человек.
  if (ageHours >= NFT_VOICE_AFTER_HOURS) {
    const voiceAlreadySent = await wasVoiceSent(accountId, peerId, NFT_VOICE_FILE);
    if (voiceAlreadySent) {
      // Голосовое уже отправлено ранее — больше ничего не говорим и не
      // предлагаем, автоответ для этого собеседника отключён.
      return { hint: null, sendVoice: false };
    }
    const plan = await getOrCreateNftVoiceAt(accountId, peerId);
    const now = Date.now();
    if (now < plan.scheduledAt.getTime()) {
      const sayWorkProblem = !plan.workMentionSent && isWorkMentionWindow(plan.scheduledAt, now);
      return {
        hint:
          'Голосовое с просьбой ещё НЕ отправляй и не анонсируй. Не пиши про токен/помощь/nft. ' +
          'Сначала ОБЯЗАТЕЛЬНО ответь по делу на его сообщение (имя, вопрос, шутка — что написал). ' +
          'Без продаж. Обычный живой ответ.',
        sendVoice: false,
        // «по работе» уходит отдельным сообщением кодом, не вместо ответа.
        sayWorkProblem,
      };
    }
    // Окно для «по работе» прошло, пока он молчал: сначала фраза, голосовое чуть позже.
    if (!plan.workMentionSent) {
      await postponeNftVoice(accountId, peerId, NFT_WORK_MENTION_MIN_MS + Math.random() * 15 * 60 * 1000);
      return {
        hint:
          'Голосовое с просьбой ещё НЕ отправляй и не анонсируй. Не пиши про токен/помощь/nft. ' +
          'Обычный живой ответ на его сообщение.',
        sendVoice: false,
        sayWorkProblem: true,
      };
    }
    return {
      hint:
        'Сейчас уйдёт голосовое. Не пиши, что возишься с токеном. ' +
        'Одна короткая живая фраза без денег и ссылок, детали будут в голосовом. Можно почти без текста.',
      sendVoice: true,
    };
  }

  // 1-й день: вообще без NFT в тексте — только живое общение (иначе отталкивает).
  if (ageHours < 24) {
    return { hint: null, sendVoice: false };
  }

  // 2-й день: максимум редкий намёк, не чаще раза в ~1.5 суток, и не всегда.
  if (await nftMentionedRecently(accountId, peerId)) {
    return { hint: null, sendVoice: false };
  }

  // ~12% ответов — иначе NFT впихивается слишком часто и выглядит как кампания.
  if (Math.random() > 0.12) {
    return { hint: null, sendVoice: false };
  }

  return {
    hint:
      '2-й день знакомства. Можно ОДИН раз очень вскользь, только если он САМ спросил про работу/деньги, ' +
      'намекнуть что работаешь онлайн / гибкий график. Без слов nft/token/flip/крипта, если он сам это не сказал. ' +
      'Полфразы, НЕ главная тема. Сначала ответь на его слова. Если намёк натянут — пропусти. Без уговоров, ссылок, сумм.',
    sendVoice: false,
  };
}

// ---------------------------------------------------------------------------
// МЕДИА (фото/видео/кружки из чата по ссылке)
// ---------------------------------------------------------------------------

// Токены, которые модель вставля��т в ответ, когда нужно прислать медиа.
const MEDIA_TOKEN_RE = /<<\s*(?:PHOTO|VIDEO|CIRCLE)\s*>>/gi;

/**
 * Вырезает из ответа модели медиа-токен и возвращает чистый текст и тип
 * запрошенного медиа ('photo' | 'video' | 'circle' | null).
 */
// Отказные / «контактные» фразы, которые НЕ должны идти вместе с реальной
// отправкой медиа. Модель иногда путает отказ в номере с просьбой кружка
// и пишет «давай пока тут общаться» + <<CIRCLE>> — выглядит как фейк.
const REFUSAL_RE =
  /(пока рано|попозже|не могу|не буду|не кину|не кидаю|потом|в другой раз|рано ещё|рано еще|не сейчас|стесняюсь|давай пока тут|тут общаться|мне так удобнее|не даю|обща(ться|емся) тут|без (кружк|фото|видео)|не записываю|не снимаю)/i;

/**
 * Текст противоречит отправке медиа (отказ / «давай только текстом»).
 * На смешанных ответах («я флиплю…» + «фото попозже») — true, если ХОТЯ БЫ
 * одна строка/предложение — отказ; чистый текст про работу без отказа — false.
 */
function isContradictoryMediaText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  // Весь ответ целиком — короткий отказ.
  const bare = t.replace(/<<Q:[\d,]+>>\s*/gi, '').trim();
  if (/^(не|неа|нет|no|nope)\b/i.test(bare) && bare.length < 80) return true;
  if (REFUSAL_RE.test(bare) && bare.length < 120) return true;
  // Длинный ответ: отказ только если он занимает заметную долю (не «потом» в другом смысле).
  const lines = bare.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const refusalLines = lines.filter((l) => REFUSAL_RE.test(l) || /^(не|неа|нет|no|nope)\b/i.test(l));
  if (refusalLines.length && refusalLines.length >= Math.ceil(lines.length / 2)) return true;
  return false;
}

/** Убирает отказные куски, оставляя нормальные ответы на другие вопросы. */
function stripContradictoryMediaParts(text) {
  const src = String(text || '');
  if (!src.trim()) return '';
  const kept = src
    .split('\n')
    .map((line) => {
      const tag = (line.match(/^\s*(?:<<Q:[\d,]+>>\s*)?/) || [''])[0];
      let body = line.slice(tag.length).trim();
      if (!body) return '';
      if (REFUSAL_RE.test(body) || /^(не|неа|нет|no|nope)\b/i.test(body)) return '';
      // Отказ во второй половине: «флиплю токены, фото попозже»
      body = body
        .split(/(?<=[.!)])\s+/)
        .filter((part) => !REFUSAL_RE.test(part) && !/^(не|неа|нет|no|nope)\b/i.test(part.trim()))
        .join(' ')
        .trim();
      return body ? tag + body : '';
    })
    .filter(Boolean);
  return kept.join('\n').trim();
}

// Явная просьба прислать медиа. Нужна, чтобы:
//  1) такая просьба имела приоритет над голосовыми заготовками (вариант Б);
//  2) отличать реальный запрос от простого вопроса про уже присланное медиа.
// Требуем И глагол-просьбу («скинь/пришли/покажи/запиши/можешь»), И объект
// («фото/видео/кружок/себя»), чтобы «куда едешь на кружочке?» НЕ считалось просьбой.
const MEDIA_REQUEST_VERB_RE =
  /(?:^|[^а-яёa-z])(?:скинь|скинешь|кинь|кинешь|пришли|пришлёшь|пришлешь|отправь|отправишь|отправляй|покажись|покажи|покажешь|запиши|запишешь|сфоткай|сфоткайся|сделай|делай|можешь|можно|давай|хочу\s+(?:увидеть|посмотреть|фото|фотк|селфи|круж|видео|видос)|дай\s+посмотреть|есть\s+фото|фото\s+есть|нет\s+фото|фото\s+нет|send|share|show|drop|give|got|wanna\s+see|want\s+(?:to\s+)?see|can\s+i\s+see|let\s+me\s+see|could\s+i\s+(?:see|get)|may\s+i\s+see|mind\s+sending)(?![а-яёa-z])/i;
const MEDIA_REQUEST_OBJ_RE =
  /(фото|фотк|фоточк|фоточ|селфи|видео|видосик|видос|кружок|кружочек|кружочк|себя|как ты выглядишь|как выглядишь|своё лицо|свое лицо|личико|форм[уые]|фигур[уые]|тело|в\s+полный\s+рост|pic(?:ture)?s?|photos?|selfie|selfies|video\s*notes?|yourself|your\s+(?:face|body|shape)|how\s+you\s+look|physique)/i;
const MEDIA_REQUEST_SHORT_RE =
  /(^|\n)\s*(а\s+|ну\s+|и\s+|ещё\s+|еще\s+|просто\s+|a\s+|just\s+|ur\s+|your\s+)?(фото|фотку|фотки|фоточку|фоточки|фотографию|селфи|видео|видос|видосик|кружок|кружочек|форму|фигуру|pic(?:ture)?s?|photos?|selfie|selfies)\s*\??\s*($|\n)/i;
// «Что по фоточкам?», «где фотки», «фотки будут?», «селфи жду», «нет фото?» — без жёсткого порядка слов.
const MEDIA_REQUEST_ASK_RE =
  /((что|как|ну)\s+(там\s+)?(по|с)\s+(фот|видео|видос|круж|селфи|форм)|(где|жду|ждём|ждем)\s+(же\s+|твои\s+|тво[её]\s+|ещё\s+|еще\s+)?(фот|видео|видос|круж|селфи|форм)|(фот|видео|видос|круж|селфи|форм)\w*\s+(жду|ждём|ждем|будут|будет|то\s+будут|то\s+будет|когда|есть\??|нет\??)|(нет|нету)\s+(у\s+тебя\s+)?(фот|селфи|круж|видео|форм)|(у\s+тебя\s+)?(есть|нету?)\s+(ещё\s+|еще\s+)?(фот|селфи|круж|видео|форм))/i;
// EN: "can I see a pic of you?", "send me a photo", "can I see you?", "pic?", "sent me"/"show me" (typo/short)
const MEDIA_REQUEST_EN_RE =
  /(?:can\s+i\s+see\s+you(?:\s+\w{1,12})?\s*[?.!]*$|can\s+i\s+see\s+(?:a\s+|your\s+|some\s+)?(?:pic(?:ture)?s?|photos?|selfie|you)|let\s+me\s+see\s+(?:a\s+|your\s+|some\s+)?(?:pic(?:ture)?s?|photos?|selfie|you)|(?:send|sent|share|show|drop|give)\s+(?:me\s+)?(?:a\s+|your\s+|some\s+)?(?:pic(?:ture)?s?|photos?|selfie)|(?:pic(?:ture)?|photo|selfie)\s+of\s+you|your\s+(?:pic(?:ture)?s?|photos?|selfie|body|shape)|(?:got|have)\s+(?:a\s+)?(?:pic(?:ture)?|photo|selfie)|wanna\s+see\s+(?:you|your\s+(?:pic|photo|face|body))|show\s+(?:me\s+)?yourself|how\s+do\s+you\s+look|^(?:send|sent|show)\s+me\s*[?.!]*$)/i;
// Обещание прислать медиа «потом» — без реальной отправки выглядит как бот-стилка.
const MEDIA_PROMISE_RE =
  /((щас|сейчас|ща|щя)[,\s]+(подожди[,\s]+)?(найду|поищу|пощу|скину|кину|отправлю|выберу|сфоткаюсь|сфоткаю|запишу)|поищу\s+(нормальн|хорош|фот|получше)|подожди[^.?\n]{0,25}(найду|поищу|выберу|скину|немного|чуть)|(?:могу|да)\s*[.,)]*\s*(?:могу\s+)?(?:скинуть|кинуть|отправить)|(?:скину|кину|отправлю)\s*(?:позже|потом|попозже|чуть\s+позже)?|\b(?:секунду|минутку)\b|(?:sec|one\s+sec|hold\s+on|give\s+me\s+a\s+(?:sec|min)|wait\s+a\s+(?:sec|bit|minute))[^.?\n]{0,30}(find|send|pick|look)?|(?:ill|i'?ll)\s+(?:find|send|pick)\s+(?:one|a\s+pic|a\s+photo|it)?|(?:can\s+send|i\s+can\s+send))/i;

/** Сообщение-правка опечатки («*поищу» / «поищу*») — не шлём и не считаем репликой. */
function isTypoFixMessage(content) {
  const t = String(content || '').trim();
  if (!t || !/[*]/.test(t)) return false;
  return /^\*?[а-яёa-z]{2,30}\*?$/i.test(t);
}

/**
 * Из входящего кружка/фото/видео модель видит длинное описание кадров.
 * Там часто «можно увидеть» + слово «кружок» в теге — это НЕ просьба скинуть своё.
 * Для детекта просьбы берём только речь/подпись собеседника.
 *
 * Также вырезаем цитаты ответа («[ответ на «…»]», «[Ответ на сообщение
 * собеседника: "…"]»). Иначе чужая фраза из цитаты читалась как просьба:
 * собеседник отвечал «👍» на «давай лучше тут общаться», а в цитате было
 * слово «видео» — и бот считала это просьбой прислать видео.
 */
function userTextForMediaIntent(text) {
  const raw = String(text || '')
    .replace(/\[(?:ответ на|уточнение к|Ответ на сообщение собеседника:)[^\]]*\]:?/gi, ' ')
    .replace(/\[уточнение к[^\]]*\]/gi, ' ')
    .replace(/\[\s*\]/g, ' ')
    .trim();
  if (!/\[(?:кружок|фото|видео)\s+от\s+собеседника\]/i.test(raw)) return raw;
  const bits = [];
  for (const m of raw.matchAll(/на видео сказано:\s*[«"]([^»"]+)[»"]/gi)) {
    if (m[1]) bits.push(m[1]);
  }
  for (const m of raw.matchAll(/Подпись:\s*"([^"]*)"/gi)) {
    if (m[1] && !/^кадр\s+из\s+(кружок|фото|видео)/i.test(m[1].trim())) bits.push(m[1]);
  }
  return bits.join(' ').trim();
}

function lastAssistantPromisedMedia(history) {
  const rows = Array.isArray(history) ? history : [];
  let seen = 0;
  for (let i = rows.length - 1; i >= 0 && seen < 8; i -= 1) {
    if (rows[i].role !== 'assistant') continue;
    const content = String(rows[i].content || '');
    if (isTypoFixMessage(content)) continue;
    seen += 1;
    if (MEDIA_PROMISE_RE.test(content) || MEDIA_STALL_RE.test(content)) return true;
  }
  return false;
}

/**
 * Он ответил цитатой на сообщение, но в самой цитате есть слова про медиа
 * («ответ на «держи, соскучилась»"»). Это НЕ просьба прислать ещё.
 */
function userAskedViaQuoteOnly(text, history) {
  const raw = String(text || '');
  const hasQuote = /\[(?:ответ на|уточнение к|Ответ на сообщение собеседника:)/i.test(raw);
  if (!hasQuote) return false;
  const body = raw
    .replace(/\[(?:ответ на|уточнение к|Ответ на сообщение собеседника:)[^\]]*\]:?/gi, ' ')
    .trim();
  if (body.split(/\s+/).filter(Boolean).length > 3) return false;
  return true;
}

// Отмазки-затяжки: «всё ещё ищу», «не могу найти», «щас сделаю новую». Держим
// отдельно от MEDIA_PROMISE_RE — вне разговора про фото эти фразы безобидны,
// поэтому срабатывают только когда человек реально ждёт медиа.
const MEDIA_STALL_RE =
  /(вс[её]\s+ещ[её]\s+ищу|пока\s+ищу|просто\s+ищу|^ищу\b|ищу\s+(фот|виде|круж|норм|подход|получше)|не\s+могу\s+(?:найти|выбрать|отыскать)\s+(?:норм|подход|хорош|фот|виде|круж|получше|ничего|ни\s*одн)|(щас|сейчас|ща|щя)\s+(попробую|сделаю|гляну|посмотрю|поищу)|попробую\s+ещ[её]\s+раз|сделаю\s+нов|still\s+looking|can'?t\s+find|cant\s+find|let\s+me\s+try\s+again)/i;

/** Сколько обещаний подряд терпим, прежде чем перестать кормить «завтраками». */
const MEDIA_PROMISE_MAX = 2;

// Явный ОТКАЗ прислать медиа («не могу такое скинуть», «не буду отправлять»).
// Если модель так ответила — это не «обещание», форсировать отправку нельзя:
// иначе файл уходит против её же слов, а постобработка калечит текст
// («не могу такое скинуть» → «не могу такое ть»).
const MEDIA_REFUSAL_RE =
  /(не\s+(?:могу|буду|хочу|стану)\s+(?:такое|это|тебе|сейчас)|не\s+(?:могу|буду|хочу)\s+\S{0,12}\s*(?:скин|кину|отправ|присл|показ|запис)|без\s+фот|не\s+(?:по\s+)?фотк|не\s+в\s+настроении\s+(?:кидать|скидывать|фоткаться))/i;

/**
 * Сколько раз подряд бот пообещала медиа и ничего не прислала.
 * Отсчёт идёт с конца истории и обрывается на реально отправленном медиа.
 */
function unfulfilledMediaPromiseCount(history) {
  const rows = Array.isArray(history) ? history : [];
  let count = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row || row.role !== 'assistant') continue;
    const content = String(row.content || '');
    if (/\[медиа:#\d+\]/.test(content)) break;
    if (isTypoFixMessage(content)) continue;
    if (MEDIA_PROMISE_RE.test(content) || MEDIA_STALL_RE.test(content)) count += 1;
  }
  return count;
}

// Обещание вместе с объектом («щас сделаю кружок)», «сейчас запишу видео»),
// чтобы после вырезания не оставалось висячего «ага, кружок)».
const MEDIA_PROMISE_WITH_OBJECT_RE =
  /(?:ага\s*)?(?:щас|сейчас|ща|щя|ok|okay|one\s+sec)[,\s]+(?:сделаю|запишу|сниму|скину|кину|отправлю|поищу|найду|выберу)\s+(?:тебе\s+)?(?:кружок|кружочек|видео|видосик|видос|фото|фотку|фоточку|селфи|video\s*note|photo|pic|selfie)\w*[)!.]*/gi;

/** Убирает из ответа само обещание, оставляя остальной текст. */
function stripMediaPromise(outText) {
  const cleaned = String(outText || '')
    .replace(MEDIA_PROMISE_WITH_OBJECT_RE, '')
    .replace(MEDIA_PROMISE_RE, '')
    .replace(MEDIA_STALL_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[\s,.;:]+|[\s,.;:]+$/g, '')
    .trim();
  if (cleaned.length < 4) return '';
  if (MEDIA_PROMISE_RE.test(cleaned) || MEDIA_STALL_RE.test(cleaned)) return '';
  return cleaned;
}

/** Короткое «давай/жду» после нашего «щас найду» — ждёт медиа. Не любой короткий вопрос. */
const MEDIA_PROMISE_ACK_RE =
  /^(?:(?:ну|да|ок|окей|ага|угу|ладно|хорошо|давай|го|жду|ждём|ждем|кидай|скидывай|можно|любые?|любой|вайб|вай|yes|yeah|ok|okay|sure|go|send|pls|please)\b[\s)!.]*)+$/i;
const CONTENT_QUESTION_RE =
  /(?:почему|зачем|отчего|когда|куда|откуда|сколько|какой|какая|какие|что\s+за|а\s+почему|why|when|where|how\s+come)/i;

function isHardMediaRequest(text, history = null) {
  if (!text) return false;
  const t = userTextForMediaIntent(text);
  if (!t) return false;
  if (MEDIA_REQUEST_VERB_RE.test(t) && MEDIA_REQUEST_OBJ_RE.test(t)) return true;
  if (MEDIA_REQUEST_SHORT_RE.test(t)) return true;
  if (MEDIA_REQUEST_ASK_RE.test(t)) return true;
  if (MEDIA_REQUEST_EN_RE.test(t)) return true;
  if (/(есть|скинь|покажись|покажи|пришли|кинь).{0,48}(фото|фотк|видео|круж|себя|селфи|форм|фигур|тело)/i.test(t)) return true;
  // Бот пообещала «щас найду» — ждём только явное согласие («давай», «жду»),
  // НЕ любой короткий вопрос («а Донецк почему выбрала» — это НЕ просьба фото).
  if (history && lastAssistantPromisedMedia(history)) {
    const bare = t.trim();
    if (CONTENT_QUESTION_RE.test(bare)) return false;
    if (bare.split(/\s+/).length <= 8 && MEDIA_PROMISE_ACK_RE.test(bare)) return true;
  }
  return false;
}

function isExplicitMediaRequest(text, history = null) {
  if (isHardMediaRequest(text, history)) return true;
  // Тема внешности («ты высокая?», «какие волосы?») — тоже повод кинуть фото по смыслу.
  return isTopicPhotoRequest(text);
}

function recentUserAskedMedia(text, history) {
  const recentUser = (history || [])
    .filter((h) => h && h.role === 'user')
    .slice(-3)
    .map((h) => userTextForMediaIntent(h.content || ''));
  return [userTextForMediaIntent(text), ...recentUser].some((s) => MEDIA_REQUEST_OBJ_RE.test(String(s || '')));
}

/**
 * «щас найду, подожди» без реального медиа в этом же ходе.
 * Если медиа-чат есть — не уводим с темы, а возвращаем флаг «надо слать».
 * Если медиа-чата нет — мягкий уход (как раньше).
 */
function resolveMediaPromise(outText, mediaType, text, history, hasMediaLink) {
  if (!outText) return { outText, forceMedia: false };
  // Медиа уже уходит в этом ходе (модель вставила токен): обещание
  // «щас найду/запишу/сделаю» лишнее — оно обещает СВЕЖУЮ съёмку, а уходит
  // готовый файл. Оставляем только живую реакцию, иначе собеседник ждёт «сейчас»
  // и ловит рассинхрон («это же не сейчас»).
  if (mediaType) {
    return { outText: stripMediaPromise(outText), forceMedia: false };
  }

  const userWantsMedia =
    recentUserAskedMedia(text, history) || isExplicitMediaRequest(text, history);
  // Ответ цитатой на «держи, соскучилась» — не просьба прислать ещё файл.
  if (userAskedViaQuoteOnly(text, history)) {
    return { outText: stripMediaPromise(outText), forceMedia: false };
  }
  const promised = MEDIA_PROMISE_RE.test(outText);
  const stalling = userWantsMedia && MEDIA_STALL_RE.test(outText);
  if (!promised && !stalling) return { outText, forceMedia: false };
  // Модель прямо отказала («не могу такое скинуть»), а не пообещала. Форсировать
  // отправку нельзя: файл уйдёт против её собственных слов. И текст не чистим —
  // иначе «не могу такое скинуть» превращается в «не могу такое ть».
  if (MEDIA_REFUSAL_RE.test(outText)) return { outText, forceMedia: false };

  const stripped = stripMediaPromise(outText);

  // Модель сама вписала «щас найду фотку» без просьбы — не форсируем отправку.
  if (!userWantsMedia) {
    return { outText: stripped || pickMediaFailDeflect(text), forceMedia: false };
  }
  // Обещали уже несколько раз подряд, а медиа в истории так и не появилось —
  // значит отправка не доходит. Хватит кормить «завтраками»: уходим с темы.
  if (unfulfilledMediaPromiseCount(history) >= MEDIA_PROMISE_MAX) {
    return { outText: pickMediaFailDeflect(text), forceMedia: false, exhausted: true };
  }
  // Обещала после просьбы и медиа есть — пусть шлёт, а не «давай без фоток».
  if (hasMediaLink) return { outText: stripped, forceMedia: true };
  return { outText: pickMediaFailDeflect(text), forceMedia: false };
}

function fixUnfulfilledMediaPromise(outText, mediaType, text, history) {
  const r = resolveMediaPromise(outText, mediaType, text, history, false);
  return r.outText;
}

function detectRequestedMediaType(text) {
  const t = userTextForMediaIntent(text);
  if (/кружок|кружочек|video\s*note|circle\s*video/i.test(t)) return 'circle';
  if (/(?:^|[^а-яёa-z])(?:видео|видос|videos?)(?![а-яёa-z])/i.test(t) && !/video\s*note/i.test(t)) {
    return 'video';
  }
  return 'photo';
}

const MEDIA_FAIL_DEFLECTS = [
  'ой что-то с фотками затык, давай лучше расскажи как день)',
  'неа, давай про тебя) чем сейчас занят?',
  'потом как-нибудь, а сейчас лучше напиши что интересного было)',
  'давай без фоток, расскажи лучше что у тебя нового)',
];
const MEDIA_FAIL_DEFLECTS_EN = [
  'ugh pics acting up, tell me about your day instead)',
  'nah later, what are you up to rn?',
  'cant pull one up rn, whats new with you)',
];

function pickMediaFailDeflect(userText = '') {
  const en = /\b(pic|photo|selfie|see you|send|show)\b/i.test(String(userText || ''));
  const bank = en ? MEDIA_FAIL_DEFLECTS_EN : MEDIA_FAIL_DEFLECTS;
  return bank[Math.floor(Math.random() * bank.length)];
}

// Было ли ПОСЛЕДНЕЕ сообщение бота отправкой медиа (метка [медиа:#id]).
// Используем, чтобы не слать второе медиа в ответ на уточняющий вопрос
// про предыдущее («а куда едешь на кружочке?»).
function lastAssistantWasMedia(history) {
  if (!Array.isArray(history)) return false;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') {
      return /\[медиа:#\d+\]/.test(String(history[i].content || ''));
    }
  }
  return false;
}

// Сомнение собеседника, что медиа снято не сейчас («это не сейчас же?»,
// «это тоже старое?»). После такой реплики нельзя слать ещё один готовый файл —
// это подтверждает, что все фото из архива, и превращается в петлю.
const PEER_MEDIA_NOT_FRESH_RE =
  /(это\s+не\s+(сейчас|свеж|сегодня)|не\s+сейчас\s+же|тоже\s+не\s+(сейчас|свеж|сегодня)|(это|тоже)\s+(старое|старая|старый|из\s+прошл|давно|не\s+свеж|не\s+сегодня)|(старое|старая|старый)\s+(фото|фотк|селфи|кадр|снимок)|ты\s+(это\s+)?(давно|раньше)\s+(снял|записал|сделал)|это\s+же\s+давно|not\s+(now|recent|fresh)|is\s+this\s+(old|recent)|(old|recent)\s+(photo|pic|picture)|was\s+this\s+taken\s+(now|recently))/i;

/** Жаловался ли он недавно, что присланное медиа не свежее (последние 2 реплики). */
function peerComplainedMediaNotFresh(userText, history) {
  if (PEER_MEDIA_NOT_FRESH_RE.test(String(userText || ''))) return true;
  const rows = Array.isArray(history) ? history : [];
  let seen = 0;
  for (let i = rows.length - 1; i >= 0 && seen < 4; i -= 1) {
    if (rows[i]?.role !== 'user') continue;
    seen += 1;
    if (PEER_MEDIA_NOT_FRESH_RE.test(String(rows[i].content || ''))) return true;
  }
  return false;
}

// Отказ бота от видео/кружка («я стесняюсь видео», «давай лучше тут общаться»).
const MEDIA_SELF_REFUSAL_RE =
  /((я\s+)?(стесняюсь|не\s+буду|не\s+хочу|не\s+могу)\s+[^.!?\n]{0,20}(видео|видос|кружок|кружочек|камер|запис)|давай\s+лучше\s+(тут|текстом)|лучше\s+(тут|текстом)\s+общаться)/i;

/** Отказывалась ли бот от видео/кружка в последних репликах (до последнего медиа). */
function botRecentlyRefusedVideo(history) {
  const rows = Array.isArray(history) ? history : [];
  let seen = 0;
  for (let i = rows.length - 1; i >= 0 && seen < 6; i -= 1) {
    const row = rows[i];
    if (!row || row.role !== 'assistant') continue;
    const content = String(row.content || '');
    if (/\[медиа:#\d+\]/.test(content)) break;
    seen += 1;
    if (MEDIA_SELF_REFUSAL_RE.test(content)) return true;
  }
  return false;
}

// «Ты реальная?», «докажи что ты не бот», «хочется общаться с реальным человеком».
// Внимание: \w в JS не матчит кириллицу — только [а-яё].
const PEER_VERIFY_HUMAN_RE =
  /(реальн[а-яё]*\s+(ты|ли|человек|человека|или)|ты\s+реальн|докаж[а-яё]*\s+(что\s+)?(ты\s+)?(реальн|человек|не\s+бот)|ты\s+(бот|не\s+человек)|реальн[а-яё]*\s+человек|точно\s+(жив[а-яё]*|человек|реальн)|настоящ[а-яё]*\s+(ты|человек)|prove\s+(you|that)\s+(are\s+)?(real|human)|are\s+you\s+(a\s+)?(bot|real|human)|(real|actual)\s+human)/i;

function peerAsksToProveHuman(text) {
  return PEER_VERIFY_HUMAN_RE.test(userTextForMediaIntent(text));
}

/**
 * Модель иногда копирует служебную метку истории
 * `[медиа:#222] {кружок: …}` вместо <<CIRCLE>> — это нельзя слать текстом в чат.
 * Вырезаем метку; тип медиа и живой хвост («ну а у тебя как?») сохраняем.
 */
function stripLeakedMediaHistoryTag(reply) {
  let text = String(reply || '');
  const typeMap = { фото: 'photo', видео: 'video', кружок: 'circle', медиа: 'photo' };
  let leakedType = null;

  text = text.replace(
    /\[медиа:#\d+\]\s*\{(фото|видео|кружок|медиа)\s*:\s*([^}]*)\}/gi,
    (_, kind, body) => {
      leakedType = typeMap[String(kind).toLowerCase()] || leakedType;
      return String(body || '').trim();
    },
  );
  text = text.replace(/\[медиа:#\d+\]\s*/gi, () => {
    if (!leakedType) leakedType = 'circle';
    return '';
  });
  // Голое `{кружок: …}` без префикса — тоже служебное.
  text = text.replace(
    /\{(фото|видео|кружок|медиа)\s*:\s*([^}]*)\}/gi,
    (_, kind, body) => {
      leakedType = typeMap[String(kind).toLowerCase()] || leakedType;
      return String(body || '').trim();
    },
  );

  text = text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text, leakedType };
}

function extractMediaRequest(reply) {
  const first = String(reply || '').match(/<<\s*(PHOTO|VIDEO|CIRCLE)\s*>>/i);
  const map = { PHOTO: 'photo', VIDEO: 'video', CIRCLE: 'circle' };
  const fromToken = first ? map[first[1].toUpperCase()] : null;
  const stripped = stripLeakedMediaHistoryTag(
    String(reply || '')
      .replace(MEDIA_TOKEN_RE, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
  );
  let text = stripped.text;
  const mediaType = fromToken || stripped.leakedType || null;

  // Подстраховка: если модель всё же прислала отказ ВМЕСТЕ с медиа-токеном
  // (например «не, давай пока тут общаться)» + <<CIRCLE>>), убираем
  // противоречивый текст — раз медиа реально уходит, отказ выглядит как фейк.
  if (mediaType && isContradictoryMediaText(text)) {
    text = stripContradictoryMediaParts(text);
  }

  return { text, mediaType };
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
    console.error(
      'Не удалось поставить реакцию:',
      err.errorMessage || err.message,
    );
    return false;
  }
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
  await client.sendMessage(sender, { message: phrase });
  await saveMessage(accountId, peerId, senderName, 'assistant', phrase);
  console.log(`[${accountLabel(accountId)}] Смех отдельным сообщением для ${senderName}: "${phrase}"`);
}

/**
 * Возвращает множество id медиа, которые уже отправлялись этом�� собеседнику
 * (для дедупа — не шлём одно и то же дважды).
 */
async function getSentMediaSet(accountId, peerId) {
  const [rows] = await db.execute(
  `SELECT content FROM conversation_messages
     WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
       AND content LIKE '[медиа:#%'`,
    [accountId, peerId],
  );
  const set = new Set();
  for (const r of rows) {
    const m = String(r.content).match(/\[медиа:#(\d+)\]/);
    if (m) set.add(Number(m[1]));
  }
  return set;
}

/** Когда можно самой кинуть кружок по смыслу (не по прямой просьбе). */
const CONTEXTUAL_CIRCLE_MIN_HISTORY = 8;
const CONTEXTUAL_CIRCLE_COOLDOWN_HOURS = 3;
/** Даже по просьбе — не больше стольких своих кружков за окно (защита от серии «на каждый его кружок»). */
const CIRCLE_RATE_MAX = 2;
const CIRCLE_RATE_WINDOW_MIN = 90;
/** Сколько минут после своего «я стесняюсь видео» не кидать видео/кружок даже по просьбе. */
const MEDIA_STUBBORN_REFUSAL_QUIET_MIN = 90;

/**
 * Бот только что отказалась от видео/кружка («я стесняюсь видео»), но собеседник
 * дожимает. Если послушать его буквально и прислать кружок — сразу видно, что
 * отказ был фейковый, а бот «не умеет» то, от чего только что отказалась.
 * Держим тишину по видео в пределах часа-двух.
 */
async function mediaRefusalQuietNow(accountId, peerId) {
  try {
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS n FROM conversation_messages
       WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
         AND (content LIKE '%стесняюсь%' OR content LIKE '%давай лучше тут общаться%'
              OR content LIKE '%я лучше текстом%' OR content LIKE '%лучше писать%')
         AND created_at > (NOW() - INTERVAL ${Number(MEDIA_STUBBORN_REFUSAL_QUIET_MIN)} MINUTE)`,
      [accountId, String(peerId)],
    );
    return Number(row?.n || 0) > 0;
  } catch (_) {
    return false;
  }
}

async function canSendContextualCircle(accountId, peerId, history) {
  const len = Array.isArray(history) ? history.length : 0;
  if (len < CONTEXTUAL_CIRCLE_MIN_HISTORY) return false;
  if (lastAssistantWasMedia(history)) return false;
  // Он только что прислал свой кружок — не зеркалим автоматически.
  const lastUser = [...(history || [])].reverse().find((h) => h?.role === 'user');
  if (lastUser && /\[кружок\s+от\s+собеседника\]/i.test(String(lastUser.content || ''))) return false;
  try {
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS n FROM conversation_messages
       WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
         AND content LIKE '[медиа:#%'
         AND created_at > (NOW() - INTERVAL ${Number(CONTEXTUAL_CIRCLE_COOLDOWN_HOURS)} HOUR)`,
      [accountId, String(peerId)],
    );
    if (Number(row?.n || 0) > 0) return false;
  } catch (_) {
    return false;
  }
  return true;
}

async function circleRateLimited(accountId, peerId) {
  try {
    const [[row]] = await db.execute(
      `SELECT COUNT(*) AS n FROM conversation_messages
       WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
         AND content LIKE '[медиа:#%'
         AND content LIKE '%{кружок:%'
         AND created_at > (NOW() - INTERVAL ${Number(CIRCLE_RATE_WINDOW_MIN)} MINUTE)`,
      [accountId, String(peerId)],
    );
    return Number(row?.n || 0) >= CIRCLE_RATE_MAX;
  } catch (_) {
    return false;
  }
}

/** Описания кадров медиа-чата: { [msgId]: 'сижу дома...' } */
function mediaDescriptionsForLink(link) {
  const cache = loadOwnMediaDesc();
  const prefix = `${link}#`;
  const out = {};
  for (const [key, val] of Object.entries(cache)) {
    if (!key.startsWith(prefix) || key.includes('|light')) continue;
    const id = key.slice(prefix.length);
    if (/^\d+$/.test(id) && typeof val === 'string' && val.trim()) out[id] = val;
  }
  return out;
}

function buildMediaContextText(userText, history) {
  // Последнее сообщение собеседника важнее истории — иначе тема тонет.
  const lastUser = String(userText || '');
  const recentUser = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'user')
    .slice(-4)
    .map((h) => String(h.content || ''))
    .join(' ');
  const recentBot = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'assistant')
    .slice(-2)
    .map((h) => String(h.content || '').replace(/\[медиа:#\d+\][^\n]*/gi, ''))
    .join(' ');
  const raw = `${lastUser} ${lastUser} ${recentUser} ${recentBot}`.slice(0, 1200);
  // Явно дописываем маркеры темы (высокая→рост/ноги/зал), чтобы скорер видел их.
  const expanded = expandMediaContextTokens(tokenizeMediaContext(raw));
  return `${raw} ${expanded.join(' ')}`.slice(0, 1600);
}

/**
 * Вопрос про внешность/тему, на который уместно ответить фото по смыслу
 * («ты высокая?», «какие волосы?», «ты в зале?»), даже без «скинь фотку».
 */
const TOPIC_PHOTO_RE =
  /(?:^|[\s,.!?])(?:ты\s+)?(?:высокая|высокий|низкая|низкий|маленькая|худая|пышная|спортивн\w*|накаченн\w*|загорел\w*)(?![а-яёa-z])|(?:какой|какая|какие|сколько)\s+(?:у\s+тебя\s+)?рост(?![а-яёa-z])|в\s+полный\s+рост|(?:какие|какой\s+цвет|какого\s+цвета)\s+(?:у\s+тебя\s+)?(?:волос|глаз)|(?:ты\s+)?(?:в\s+зале|из\s+зала|после\s+зала|из\s+качалки)|(?:занимаешься|занимаешся)\s+спорт|(?:какие|какая)\s+(?:у\s+тебя\s+)?(?:форм|фигур)|(?:что\s+на\s+тебе|как\s+одета|во\s+что\s+одета)|(?:ты\s+)?(?:брюнетк|блондинк|шатенк|рыж(?:ая|енькая)?)(?![а-яёa-z])|(?:есть\s+(?:ли\s+)?(?:у\s+тебя\s+)?)?(?:тату|пирсинг)(?![а-яёa-z])|(?:как\s+ты\s+выглядишь|как\s+выглядишь)|are\s+you\s+tall|how\s+tall\s+are\s+you|what\s+color\s+(?:are\s+)?your\s+(?:eyes|hair)|do\s+you\s+(?:go\s+to\s+)?(?:the\s+)?gym|you\s+workout/i;

function isTopicPhotoRequest(text) {
  const t = userTextForMediaIntent(text);
  if (!t) return false;
  // Не длинное эссе — короткие вопросы/реплики про внешность.
  if (t.length > 180) return false;
  return TOPIC_PHOTO_RE.test(t);
}

// Описания своих медиа из медиа-чата: ключ `${link}#${msgId}`, считаются один раз.
const OWN_MEDIA_DESC_PATH = path.join(__dirname, '..', 'media', 'own_media_desc.json');
const OWN_MEDIA_LABEL = { photo: 'фото', video: 'видео', circle: 'кружок' };
const OWN_MEDIA_LABEL_GEN = { photo: 'фото', video: 'видео', circle: 'кружка' };
let ownMediaDescCache = null;

function loadOwnMediaDesc() {
  if (ownMediaDescCache) return ownMediaDescCache;
  try {
    ownMediaDescCache = JSON.parse(fs.readFileSync(OWN_MEDIA_DESC_PATH, 'utf8')) || {};
  } catch (_) {
    ownMediaDescCache = {};
  }
  return ownMediaDescCache;
}

function saveOwnMediaDesc(cache) {
  try {
    fs.writeFileSync(OWN_MEDIA_DESC_PATH, JSON.stringify(cache, null, 1));
  } catch (e) {
    console.error('Не удалось сохранить описания своих медиа:', e.message);
  }
}

async function loadOwnMediaFrames(client, item, mediaType) {
  if (!item.msg) return [];
  let frames = [];
  // Whisper на беззвучных кружках галлюцинирует («спасибо за просмотр») — звук не берём.
  const buf = await client.downloadMedia(item.msg, {});
  if (mediaType === 'photo') {
    if (buf && buf.length) frames = [buf];
  } else if (buf && buf.length && buf.length <= MAX_INCOMING_VIDEO_BYTES) {
    frames = await extractVideoFrameBuffers(buf, 2);
  }
  if (!frames.length && mediaType !== 'photo') {
    try {
      const thumb = await client.downloadMedia(item.msg, { thumb: 0 });
      if (thumb && thumb.length) frames = [thumb];
    } catch (_) {}
  }
  return frames;
}

async function getOwnMediaDescription(client, item, mediaType, link) {
  const key = `${link}#${item.id}`;
  const cache = loadOwnMediaDesc();
  if (cache[key]) return cache[key];
  const frames = await loadOwnMediaFrames(client, item, mediaType);
  const desc = await describeOwnMedia(frames, OWN_MEDIA_LABEL_GEN[mediaType] || 'видео');
  if (desc) {
    cache[key] = desc;
    saveOwnMediaDesc(cache);
  }
  return desc;
}

// ---------------------------------------------------------------------------
// Свет на своих медиа: ночью не шлём кружок/фото, снятые при дневном свете
// (человек сразу видит «у тебя что-то светло там» в полночь).
// ---------------------------------------------------------------------------

// Восход / закат по МСК для средней полосы, по месяцам (янв..дек).
const SUNRISE_MSK = [9, 8, 7, 6, 5, 4, 4, 5, 6, 7, 8, 9];
const SUNSET_MSK = [16, 17, 18, 19, 20, 21, 21, 20, 19, 17, 16, 16];
const ownMediaLightInFlight = new Map();
const ownMediaLightWarmup = new Set();

function isDarkOutsideNow(date = new Date()) {
  const msk = new Date(date.getTime() + 3 * 3600 * 1000);
  const month = msk.getUTCMonth();
  const hour = msk.getUTCHours() + msk.getUTCMinutes() / 60;
  return hour < SUNRISE_MSK[month] || hour >= SUNSET_MSK[month] + 1;
}

function cachedOwnMediaLight(item, link) {
  return loadOwnMediaDesc()[`${link}#${item.id}|light`] || null;
}

async function getOwnMediaLight(client, item, mediaType, link) {
  const key = `${link}#${item.id}|light`;
  const known = loadOwnMediaDesc()[key];
  if (known) return known;
  if (ownMediaLightInFlight.has(key)) return ownMediaLightInFlight.get(key);
  const job = (async () => {
    const frames = await loadOwnMediaFrames(client, item, mediaType);
    const light = await classifyOwnMediaLight(frames);
    if (light) {
      const cache = loadOwnMediaDesc();
      cache[key] = light;
      saveOwnMediaDesc(cache);
    }
    return light;
  })().finally(() => ownMediaLightInFlight.delete(key));
  ownMediaLightInFlight.set(key, job);
  return job;
}

// Лимит OpenAI общий с ответами: фоновая разметка идёт медленно и уступает при 429.
const OWN_MEDIA_LIGHT_WARMUP_STEP_MS = 15000;
const OWN_MEDIA_LIGHT_RATE_PAUSE_MS = 5 * 60 * 1000;
let ownMediaLightPausedUntil = 0;

/** Фоном размечает свет у всех медиа чата, чтобы ночью было из чего выбрать без задержки. */
function warmOwnMediaLight(client, accountId, link, items) {
  if (Date.now() < ownMediaLightPausedUntil) return;
  if (ownMediaLightWarmup.has(link)) return;
  const todo = items.filter((i) => !cachedOwnMediaLight(i, link));
  if (!todo.length) return;
  ownMediaLightWarmup.add(link);
  (async () => {
    for (const item of todo) {
      if (!getActiveClient(accountId) || Date.now() < ownMediaLightPausedUntil) break;
      if (cachedOwnMediaLight(item, link)) continue;
      try {
        await getOwnMediaLight(client, item, item.type, link);
      } catch (err) {
        if (err?.status === 429) {
          ownMediaLightPausedUntil = Date.now() + OWN_MEDIA_LIGHT_RATE_PAUSE_MS;
          console.error('[медиа] Лимит OpenAI — разметку света ставлю на паузу 5 мин.');
          break;
        }
        if (isFloodError(err)) break;
      }
      await sleep(OWN_MEDIA_LIGHT_WARMUP_STEP_MS);
    }
  })().finally(() => ownMediaLightWarmup.delete(link));
}

/** Ночью — не шлём то, что ТОЧНО снято днём на улице. Неразмеченное можно. */
async function filterMediaForDaylight(client, items, mediaType, link, sentIds) {
  // Фильтр симметричный: ночью не шлём явно дневные кадры, днём — явно ночные.
  // Раньше дневная половина была отключена, и в обед уходили ночные кружки.
  const banned = isDarkOutsideNow() ? 'day' : 'dark';
  const ofType = items.filter((i) => i.type === mediaType);
  // Остальное (помещение / неразмеченное) подходит в любое время суток.
  const ok = ofType.filter((i) => cachedOwnMediaLight(i, link) !== banned);
  if (ok.some((i) => !sentIds.has(i.id))) return ok;
  // Все неразмеченные уже уходили этому человеку, а «не дневных» не осталось —
  // пробуем класифицировать до 2 неизвестных (вдруг там помещение).
  const unknown = ofType
    .filter((i) => !cachedOwnMediaLight(i, link) && !sentIds.has(i.id))
    .sort(() => Math.random() - 0.5)
    .slice(0, 2);
  for (const item of unknown) {
    const light = await Promise.race([
      getOwnMediaLight(client, item, mediaType, link).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 20000)),
    ]);
    if (light && light !== banned) ok.push(item);
  }
  return ok;
}

const OWN_MEDIA_LIGHT_NOTE = { day: 'снято днём, при дневном свете', dark: 'снято вечером, темно', indoor: 'в помещении' };

async function ownMediaHistoryTag(client, item, mediaType, link) {
  let desc = '';
  try {
    desc = await Promise.race([
      getOwnMediaDescription(client, item, mediaType, link),
      new Promise((resolve) => setTimeout(() => resolve(''), 30000)),
    ]);
  } catch (e) {
    console.error('Не удалось описать своё медиа:', e.message);
  }
  const light = OWN_MEDIA_LIGHT_NOTE[cachedOwnMediaLight(item, link)];
  if (desc && light) desc = `${desc} (${light})`;
  return desc ? `${mediaTag(item.id)} {${OWN_MEDIA_LABEL[mediaType] || 'медиа'}: ${desc}}` : mediaTag(item.id);
}

/**
 * В��бирает и отправляет случайное неотправленное медиа нужного типа из
 * медиа-чата аккаунта. Возвращает true, если медиа реа����ь��о ушло.
 */
async function trySendMedia(
  client,
  sender,
  accountId,
  peerId,
  senderName,
  mediaType,
  link,
  contextText = '',
) {
  try {
    if (mediaType === 'circle' && (await circleRateLimited(accountId, peerId))) {
      console.log(
        `[${accountLabel(accountId)}] Лимит кружков (${CIRCLE_RATE_MAX} / ${CIRCLE_RATE_WINDOW_MIN} мин) для ${senderName} — не шлю.`,
      );
      return false;
    }
    const sentIds = await getSentMediaSet(accountId, peerId);
    let record = await getMediaItems(client, accountId, link);
    warmOwnMediaLight(client, accountId, link, record.items);
    const filtered = await filterMediaForDaylight(client, record.items, mediaType, link, sentIds);
    const descriptions = mediaDescriptionsForLink(link);
    let item = pickMediaByContext(filtered, mediaType, sentIds, descriptions, contextText)
      || pickUnsentMedia(filtered, mediaType, sentIds, descriptions);
    if (!item) {
      console.log(
        `[${accountLabel(accountId)}] Нет подходящего медиа типа "${mediaType}" для ${senderName}` +
          (isDarkOutsideNow() ? ' (на улице темно, дневные не шлю).' : ' (на улице светло, ночные не шлю).'),
      );
      return false;
    }

    try {
      const hist = await getHistory(accountId, peerId).catch(() => []);
      const capLang = detectReplyLanguage(contextText, hist);
      const caption = mediaType === 'circle' ? '' : pickCaption(mediaType, capLang === 'ru' ? 'ru' : 'en');
      await sendMediaItem(client, sender, item, caption);
    } catch (e) {
      // Устаревшая ссылка на файл — сбрасываем кэш и пробуем ещё раз.
      if (String(e.message || '').includes('FILE_REFERENCE')) {
        clearMediaCache(accountId, link);
        record = await getMediaItems(client, accountId, link);
        item = record.items.find((i) => i.id === item.id) || item;
        const hist = await getHistory(accountId, peerId).catch(() => []);
        const capLang = detectReplyLanguage(contextText, hist);
        const caption = mediaType === 'circle' ? '' : pickCaption(mediaType, capLang === 'ru' ? 'ru' : 'en');
        await sendMediaItem(client, sender, item, caption);
      } else {
        throw e;
      }
    }

    const historyTag = await ownMediaHistoryTag(client, item, mediaType, link);
    await saveMessage(accountId, peerId, senderName, 'assistant', historyTag);
    const matched = descriptions[String(item.id)] || descriptions[item.id] || '';
    console.log(
      `[${accountLabel(accountId)}] Отправлено медиа (${mediaType}) #${item.id} для ${senderName}` +
        (matched ? ` [по смыслу: ${matched.slice(0, 60)}]` : '') +
        `: ${historyTag}`,
    );
    return true;
  } catch (err) {
    console.error(
      `[${accountLabel(accountId)}] Ошибка отправки медиа (${mediaType}): ${err.message}`,
    );
    return false;
  }
}

/**
 * Шлёт медиа всем, кто явно попросил. Если не вышло — мягко уводит с темы
 * (без «щас найду» / «потом скину»).
 */
async function sendRequestedMediaOrDeflect(
  client,
  sender,
  accountId,
  peerId,
  senderName,
  mediaType,
  mediaLink,
  contextText = '',
  { allowDeflect = true } = {},
) {
  if (!mediaType || !mediaLink) return false;
  try {
    await client.invoke(
      new Api.messages.SetTyping({
        peer: sender,
        action:
          mediaType === 'photo'
            ? new Api.SendMessageUploadPhotoAction({ progress: 0 })
            : new Api.SendMessageUploadVideoAction({ progress: 0 }),
      }),
    );
  } catch (_) {
    // индикатор не критичен
  }
  await sleep(1200 + Math.random() * 1200);
  const sent = await trySendMedia(
    client,
    sender,
    accountId,
    peerId,
    senderName,
    mediaType,
    mediaLink,
    contextText,
  );
  if (sent) return true;
  if (!allowDeflect) return false;
  // Лимит кружков — текст ответа уже ушёл, не подменяем на «затык с фотками».
  if (mediaType === 'circle' && (await circleRateLimited(accountId, peerId))) return false;

  const deflect = pickMediaFailDeflect(contextText);
  try {
    await client.sendMessage(sender, { message: deflect });
    await saveMessage(accountId, peerId, senderName, 'assistant', deflect);
    console.log(
      `[${accountLabel(accountId)}] Медиа не ушло ${senderName} — мягкий уход с темы: "${deflect}"`,
    );
  } catch (err) {
    console.error(
      `[${accountLabel(accountId)}] Не удалось отправить уход с темы после медиа:`,
      err.message,
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// «СКОЛЬКО ДНЕЙ НА ДВ» + АВТОАРХИВ, ЕСЛИ ОН ТАМ 2 НЕДЕЛИ И БОЛЬШЕ
// ---------------------------------------------------------------------------

// Пока идёт пауза перед вопросом, второе входящее не должно отправить его повторно.
const howLongInFlight = new Set();

// Все варианты содержат «на дв?» — по этой подстроке ищем вопрос в истории.
const HOWLONG_QUESTIONS = [
  'слушай, а ты скок дней уже сидишь на дв?',
  'кстати, а сколько дней ты уже на дв?',
  'а скок ты уже дней на дв?',
];
const HOWLONG_MARKER = 'на дв?';
const HOWLONG_LEGACY_MARKER = 'давно тут сидишь';

function buildHowLongQuestion() {
  return HOWLONG_QUESTIONS[Math.floor(Math.random() * HOWLONG_QUESTIONS.length)];
}

// Вопрос — 3-м сообщением бота; если в тот ход нельзя (ответ уже с вопросом,
// голосовое, медиа, он сам что-то спросил) — ещё несколько ходов, дальше не спрашиваем.
const HOWLONG_BOT_MSGS_FROM = 2;
// Раньше окно было до 6 реплик — часто не успевали спросить (вопросы/медиа
// откладывали ход). Держим шире, пока диалог свежий.
const HOWLONG_BOT_MSGS_TO = 12;
// Только новые диалоги: первое сообщение не старше этого.
const HOWLONG_NEW_DIALOG_HOURS = 72;
const HOWLONG_ARCHIVE_DAYS = 14;

function isHowLongQuestion(content) {
  const c = String(content || '');
  return c.includes(HOWLONG_MARKER) || c.includes(HOWLONG_LEGACY_MARKER);
}

async function wasHowLongAsked(accountId, peerId) {
  const [rows] = await db.execute(
    `SELECT id FROM conversation_messages
     WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
       AND (content LIKE ? OR content LIKE ?)
     LIMIT 1`,
    [accountId, peerId, `%${HOWLONG_MARKER}%`, `%${HOWLONG_LEGACY_MARKER}%`],
  );
  return rows.length > 0;
}

async function getHowLongDialogStats(accountId, peerId) {
  const [rows] = await db.execute(
    `SELECT
       SUM(role = 'assistant' AND content NOT LIKE '[реакция:%' AND content NOT LIKE '%*') AS bot_msgs,
       TIMESTAMPDIFF(HOUR, MIN(created_at), NOW()) AS age_hours
     FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?`,
    [accountId, peerId],
  );
  const row = rows[0] || {};
  return { botMsgs: Number(row.bot_msgs) || 0, ageHours: row.age_hours == null ? null : Number(row.age_hours) };
}

/**
 * Текущее входящее — первый ответ на вопрос «сколько дней на дв»:
 * после вопроса в истории нет ни одного сообщения собеседника.
 */
function isAnswerToHowLong(history) {
  for (let i = (history || []).length - 1; i >= 0; i -= 1) {
    const h = history[i];
    if (h.role === 'user') return false;
    if (h.role === 'assistant' && isHowLongQuestion(h.content)) return true;
  }
  return false;
}

const STAY_NUM_WORDS = {
  полтора: 1.5, полторы: 1.5, одну: 1, один: 1, одна: 1, две: 2, два: 2, пару: 2, парочку: 2,
  три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15,
  двадцать: 20, тридцать: 30, сорок: 40, несколько: 3,
};
const STAY_NUM = `(\\d+(?:[.,]\\d+)?|${Object.keys(STAY_NUM_WORDS).join('|')})`;
const STAY_UNITS = [
  { re: '(?<![а-я])год[а-я]*|(?<![а-я])лет(?![а-я])', days: 365 },
  { re: 'полгода|пол\\s+года', days: 180, noNum: true },
  { re: 'месяц[а-я]*|мес(?=[^а-я]|$)', days: 30 },
  { re: 'недел[а-я]*|нед(?=[^а-я]|$)', days: 7 },
  { re: 'дн[а-я]*|день|сут[а-я]*', days: 1 },
];

function stayNum(raw) {
  if (raw == null) return null;
  const w = String(raw).toLowerCase();
  if (STAY_NUM_WORDS[w] != null) return STAY_NUM_WORDS[w];
  const n = parseFloat(w.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Сколько дней он на платформе, по его ответу. null — не понятно.
 * «месяц» → 30, «две недели» → 14, «дня 3» → 3, «20» (на вопрос про дни) → 20.
 */
function parseStayDays(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/^\[[^\]]*\]:\s*/g, '')
    .replace(/мне\s+\d+\s*(лет|год[а-я]*)?/g, ' ')
    .trim();
  if (!t) return null;
  // Только короткий ответ «с лета» / «с прошлого года» — не «с лета хотел…».
  if (/^(?:ну\s+|да\s+)?с\s+(лета|весны|зимы|осени|прошлого|того)(?:\s+год[а]?)?[\s)!.]*$/i.test(t)) {
    return 90;
  }
  if (/(недавно|не\s+давно|только\s+(что|зашел|зашла|начал|скачал|сегодня)|первый\s+день|с\s+сегодня|со\s+вчера|сегодня|вчера)/.test(t)) {
    return 1;
  }
  let best = null;
  for (const unit of STAY_UNITS) {
    const before = new RegExp(`${STAY_NUM}?\\s*(?:с\\s+)?(?:${unit.re})`, 'g');
    let m;
    while ((m = before.exec(t))) {
      let n = unit.noNum ? 1 : stayNum(m[1]);
      if (n == null) {
        const after = t.slice(m.index + m[0].length).match(new RegExp(`^\\s*${STAY_NUM}`));
        n = after ? stayNum(after[1]) : 1;
      }
      const days = n * unit.days;
      if (best == null || days > best) best = days;
    }
  }
  if (best != null) return best;
  // Только короткий ответ целиком — не «давно хотел написать» / «долго думал».
  if (/^(?:ну\s+|да\s+|хз,?\s*)?(?:очень\s+)?(?:давно|долго|дофига|вечность)[\s)!.]*$/i.test(t)) {
    return 60;
  }
  if (/^(?:ну\s+|да\s+)?много\s+времени[\s)!.]*$/i.test(t)) return 60;
  // Голое число — только если это весь ответ (на вопрос «сколько дней»).
  const bare = t.match(/^(?:ну\s+|где[- ]то\s+|около\s+|примерно\s+|дня\s+)?(\d{1,3})[\s)!.]*$/);
  if (bare) {
    const n = Number(bare[1]);
    // 1–3 часто «возраст/час», но на how-long уже гейт isAnswerToHowLong.
    if (n >= 1 && n <= 3650) return n;
  }
  return null;
}

function findAccountIdByClient(client) {
  for (const [id, c] of activeClients.entries()) {
    if (c === client) return id;
  }
  return null;
}

function persistArchiveState(client, peer, archived) {
  try {
    const accountId = findAccountIdByClient(client);
    const peerId = peer?.userId ?? peer?.id ?? peer;
    if (!accountId || peerId == null) return;
    const leadScoring = require('./leadScoring');
    if (archived) leadScoring.markPeerArchived(accountId, peerId).catch(() => {});
    else leadScoring.markPeerUnarchived(accountId, peerId).catch(() => {});
  } catch (_) {
    /* ignore */
  }
}

async function archivePeer(client, inputPeer) {
  const peer = await client.getInputEntity(inputPeer);
  await client.invoke(
    new Api.folders.EditPeerFolders({
      folderPeers: [
        new Api.InputFolderPeer({ peer, folderId: 1 }),
      ],
    }),
  );
  markArchivedInCache(client, peer);
  persistArchiveState(client, peer, true);
  return true;
}

/** Вернуть диалог из архива в основной список (folderId 0). */
async function unarchivePeer(client, inputPeer) {
  const peer = await client.getInputEntity(inputPeer);
  await client.invoke(
    new Api.folders.EditPeerFolders({
      folderPeers: [
        new Api.InputFolderPeer({ peer, folderId: 0 }),
      ],
    }),
  );
  const flags = archiveFlagsCache.get(client)?.flags;
  const id = peer?.userId ?? peer?.id;
  if (flags && id != null) flags.set(String(id), false);
  persistArchiveState(client, peer, false);
  return true;
}

// Незамьюченный архивный чат Telegram сам возвращает в список при новом сообщении.
async function mutePeerForever(client, inputPeer) {
  const peer = await client.getInputEntity(inputPeer);
  await client.invoke(
    new Api.account.UpdateNotifySettings({
      peer: new Api.InputNotifyPeer({ peer }),
      settings: new Api.InputPeerNotifySettings({ muteUntil: 2147483647 }),
    }),
  );
}

async function shouldAskHowLong(accountId, peerId) {
  if (howLongInFlight.has(bufferKey(accountId, peerId))) return false;
  if (await wasHowLongAsked(accountId, peerId)) return false;
  const { botMsgs, ageHours } = await getHowLongDialogStats(accountId, peerId);
  if (ageHours == null || ageHours > HOWLONG_NEW_DIALOG_HOURS) return false;
  return botMsgs >= HOWLONG_BOT_MSGS_FROM && botMsgs <= HOWLONG_BOT_MSGS_TO;
}

/**
 * Извлекает текст из входящего сообщения.
 *   - обычный текст -> возвращается как есть;
 *   - голосовое/аудио -> скачивается и расшифровывается через Whisper;
 *   - фото -> скачивается и описывается через vision.
 * Для голосовых и фото результат помечается тегом, чтобы AI понимал контекст.
 */
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

function withQuote(text, quote) {
  const body = String(text || '').trim();
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
      const buffer = await client.downloadMedia(message, {});
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
      const buffer = await client.downloadMedia(message, {});
      if (buffer && buffer.length) {
        const visionLang = peerId
          ? await conversationReplyLang(accountId, peerId, rawText)
          : 'ru';
        const description = await describeImage(buffer, rawText, visionLang);
        if (isViewOnceOrExpiringMedia(message) || spoiler) {
          await markMessageContentsOpened(client, message);
        }
        if (description) {
          console.log(
            `[${accountLabel(accountId)}] Фото распознано: "${description}"`,
          );
          const caption = rawText ? ` Подпись: "${rawText}".` : '';
          const once = isViewOnceOrExpiringMedia(message) ? 'одноразовое ' : '';
          const spoil = spoiler && !once ? 'спойлер-' : '';
          return attach(`[${once}${spoil}фото от собеседника]: ${description}.${caption}`);
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
    const buffer = await client.downloadMedia(message, {});
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
      const buffer = await client.downloadMedia(message, {});
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

/**
 * Приём входящего сообщения. Не отвечает сразу, а кладёт сообщение в буфер
 * и запускает таймер ожидания. Если собеседник за это время пишет ещё —
 * таймер сбрасывается, а тексты копятся, чтобы ответить од��н раз на все.
 */
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
      // и перезапускаем т��ймер ожидания.
      existing.texts.push(text);
      existing.sender = sender;
      existing.message = message;
      clearTimeout(existing.timer);

      // Не даём серии тяну��ься бесконечно: ограничиваем таймер так, чтобы
      // общее ожидание не превысило AGGREGATE_MAX_WAIT_MS.
      const elapsed = Date.now() - existing.startedAt;
      const remaining = Math.max(0, AGGREGATE_MAX_WAIT_MS - elapsed);
      const wait = Math.min(AGGREGATE_WINDOW_MS, remaining);

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
    const entry = {
      texts: [text],
      sender,
      message,
      startedAt: Date.now(),
      timer: setTimeout(
        () => flushMessageBuffer(accountId, peerId, senderName),
        AGGREGATE_WINDOW_MS,
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

  await processBufferedMessages(
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
function scheduleAfterthought(accountId, sender, peerId, senderName, prevOutText) {
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
        const client = getActiveClient(accountId);
        if (!client) return;
        const settings = await getAccountSettings(accountId);
        if (!settings?.enabled) return;
        if (!isWithinWorkingHours(settings)) return;
        await waitBeforeReply(client, sender, 900 + Math.random() * 1200, 800);
        await client.sendMessage(sender, { message: phrase });
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

function scheduleReengage(accountId, sender, peerId, senderName, history, text, message) {
  const key = bufferKey(accountId, peerId);
  if (deferredDialogs.has(key)) return;

  const delay =
    DEFER_MIN_MS + Math.floor(Math.random() * (DEFER_MAX_MS - DEFER_MIN_MS));
  const timer = setTimeout(() => {
    fireReengage(accountId, peerId).catch((e) =>
      console.error(
        `[${accountLabel(accountId)}] Ошибка отложенного ответ��:`,
        e.message,
      ),
    );
  }, delay);
  // Не держим п��оцесс живым только ради этого таймера.
  if (typeof timer.unref === 'function') timer.unref();

  deferredDialogs.set(key, { timer, sender, senderName, history, text, message });
  console.log(
    `[${accountLabel(accountId)}] «Занята»: молчу ${Math.round(
      delay / 60000,
    )} мин для ${senderName}, потом отвечу на её сообщение.`,
  );
}

/**
 * Срабатывает по таймеру паузы: бот генерирует и отправляет НАСТОЯЩИЙ AI-ответ
 * на сообщение, которо�� ждало во время «занятости» — так со стороны выгля��ит
 * будто человек отвлёкся, но всё равно ответил на заданный вопрос, а не забыл
 * про него. Проверяет активность, автоответчик и рабочие часы перед отправкой.
 */
async function fireReengage(accountId, peerId) {
  const key = bufferKey(accountId, peerId);
  const entry = deferredDialogs.get(key);
  deferredDialogs.delete(key);
  if (!entry) return;

  const { sender, senderName, history, text, message } = entry;

  const client = getActiveClient(accountId);
  if (!client) return;
  const settings = await getAccountSettings(accountId);
  if (!settings || !settings.is_autoreply_enabled) return;
  if (await isPeerBlacklisted(accountId, peerId)) return;
  // Если этому собеседнику ранее ушло голосовое с просьбой о помощи — проверяем
  // согласие ДО отключения автоответа. Голосовые собеседника уже расшифрованы
  // в текст на этапе extractIncomingText, так ��то распознаётся и голосовой,
  // и текстовый ответ. Проверяем всегда, даже если автоответ уже отключён —
  // иначе после ��ер��ого отключения согласие на ��альнейшие сообщения перестало
  // бы детектиров��ться вовсе.
  await helpRequestNotifier.checkConsent(accountId, peerId, senderName, settings.phone, text, accountLabel(accountId));
  // После отправки голосового с просьбой о помощи автоответ для э��ого
  // конкретного собеседника отключён — дальше ве��ёт оператор вр��чную.
  if (await helpRequestNotifier.isAutoreplyDisabledForPeer(accountId, peerId)) return;
  // Вне её режима дня не пишем — непрочитанное подхватит после подъёма.
  if (!isWithinWorkingHours(accountId)) return;
  // Архив — никогда не читаем и не пишем, в том числе отложенным ответом.
  if (await isPeerArchived(client, sender)) {
    console.log(
      `[${accountLabel(accountId)}] Отложенный ответ отменён — ${senderName} в архиве.`,
    );
    return;
  }
  // «Удалить у меня и у собеседника» — триггер-сообщения уже нет, не пишем в пустой чат.
  if (await cancelReplyIfDialogGone(client, accountId, sender, senderName, message, 'отложенный')) {
    return;
  }

  let workMentionClaimed = false;
  try {
    const mediaLink =
      typeof settings.media_chat_link === 'string'
        ? settings.media_chat_link.trim()
        : '';
    const sexualPressure = objectionHandler.isSexualPressure(text);
    const topicPhoto =
      !sexualPressure &&
      !!mediaLink &&
      isTopicPhotoRequest(text) &&
      !lastAssistantWasMedia(history);
    const hardMediaRequest = !sexualPressure && isHardMediaRequest(text, history);
    const explicitMediaRequest = hardMediaRequest || topicPhoto;
    // Отложенный ответ тоже должен отдавать медиа, если человек просил —
    // раньше тут было mediaEnabled=false и фото «пропадало», а другим уходило.
    const mediaEnabled = !!mediaLink && explicitMediaRequest;
    const contextualCircle =
      !!mediaLink && !explicitMediaRequest && (await canSendContextualCircle(accountId, peerId, history));
    const noMediaExcuse = explicitMediaRequest && !mediaLink;
    const nft = await getNftCampaignState(accountId, peerId, history.length);
    const suppressNft = shouldSuppressNftForTurn(text, {
      flipPhotoQuestion: false,
      explicitMediaRequest,
      history,
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
    if (timeInfo.isSleep) {
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
    const awayMin = await humanExtra.lastAssistantAgeMinutes(db, accountId, peerId);
    const awayHint = morningHint ? null : humanExtra.awayReturnHint(awayMin);
    const detailHint = humanExtra.buildHisDetailCallbackHint(history, text);
    const liveHistory = await getHistory(accountId, peerId);
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
    // How-long ack важнее generic later/dont_understand — иначе «потом» съедает реакцию на дв.
    let objectionHint = null;
    if (flipPhotoQuestion) {
      objectionHint = objectionHandler.getFlipPhotoQuestionHint();
    } else if (isAnswerToHowLong(replyHistory)) {
      objectionHint = objectionHandler.getHowLongAckHint(text);
    } else {
      objectionHint = objectionHandler.detectHint(text, replyHistory);
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
    const dialogAgeHours = await getDialogAgeHours(accountId, peerId);
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

    const emotionHint = buildEmotionHint(replyHistory);
    const sessionForgetHint = buildSessionForgetHint(replyHistory.length <= 4);
    const memoryContextHint = sessionForgetHint
      ? null
      : await memoryTriggers.buildMemoryContextHint(accountId, peerId);

    // Без typing во время AI: иначе «печатает» при непрочитанном — палево.
    let rawReply;
    if (!settings.prompt || !String(settings.prompt).trim()) {
      console.warn(
        `[${accountLabel(accountId)}] Промпт аккаунта пустой — уйдёт DEFAULT_PROMPT (проверь кабинет).`,
      );
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
      accountId,
    });
    if (!rawReply) {
      rawReply = ['ага)', 'ну ок)', 'хм ок)', 'поняла)'][Math.floor(Math.random() * 4)];
      console.warn(
        `[${accountLabel(accountId)}] Пустой AI-ответ для ${senderName} — мягкий fallback.`,
      );
    }
    rawReply = sanitizeReplyAgainstNftLeak(rawReply, objectionHint);
    if (sexualPressure || objectionHandler.isNudeAsk(text)) {
      rawReply = objectionHandler.softenSexualPressureReply(rawReply, text);
    }
    // echoLength / antiMirror уже в finalize aiResponder — второй раз не режем.
    if (dueMemory && useMemoryHint && !sessionForgetHint) memoryTriggers.markFollowedUp(dueMemory.id).catch(() => {});

    const { text: replyWithoutLaugh, laugh } = splitLaugh(rawReply);
    const { text: replyWithoutReact, reaction } = extractReaction(replyWithoutLaugh);
    const { text: reply, mediaType: rawMediaType } =
      extractMediaRequest(replyWithoutReact);

    let mediaType = rawMediaType;
    if (explicitMediaRequest && mediaLink && !mediaType) {
      mediaType = detectRequestedMediaType(text);
    }
    if (sexualPressure && mediaType) {
      console.log(`[${accountLabel(accountId)}] Подавил медиа на секс-давление от ${senderName}.`);
      mediaType = null;
    }
    // Без прямой просьбы — НЕ шлём фото/видео вообще (только редкий кружок по смыслу).
    // Раньше после «щас найду» любой короткий вопрос («почему Донецк?») считался просьбой.
    if (!explicitMediaRequest) {
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
    if (mediaType && !explicitMediaRequest && lastAssistantWasMedia(history)) {
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

    let outText = reply;
    if (!outText && rawMediaType && !mediaType && !reaction) {
      const fillers = ['да по делам)', 'та так, по своим)', 'ничего особенного)', 'да ничё такого)'];
      outText = fillers[Math.floor(Math.random() * fillers.length)];
    }

    if (mediaType && mediaEnabled && isContradictoryMediaText(outText)) {
      console.log(
        `[${accountLabel(accountId)}] Убрал отказной текст перед медиа для ${senderName}: "${outText}"`,
      );
      outText = stripContradictoryMediaParts(outText);
    }
    {
      const resolved = resolveMediaPromise(
        outText,
        mediaType && mediaLink ? mediaType : null,
        text,
        history,
        !!mediaLink,
      );
      if (resolved.forceMedia && mediaLink) {
        mediaType = mediaType || detectRequestedMediaType(text);
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

    // «по работе» — только после ответа, отдельным сообщением (maybeSendWorkAside).
    const pendingWorkAside = !!nft.sayWorkProblem;

    const reactionOnly = !!reaction && !outText && !mediaType && !nft.sendVoice;
    const lateTextMs = humanExtra.reactThenTextDelayMs(accountId, reaction, outText);

    // Read → dwell → typing → send (не typing до прочтения).
    const delayMs = delayBeforeSendMs(settings, outText, { accountId });
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
        Math.min(computeTypingMs(outText, accountId), delayMs),
        text,
        accountId,
      );
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
      outText = humanExtra.applyAccountSlang(outText, accountId);
      await sendHumanText(client, sender, accountId, peerId, senderName, outText, text);
      lastReplyAt.set(bufferKey(accountId, peerId), Date.now());
      await learningDb.recordBotReply(accountId, peerId, text, stripQuestionTags(outText), learningStage);
      console.log(
        `[${accountLabel(accountId)}] Отложенный ответ для ${senderName}: "${stripQuestionTags(outText)}"`,
      );
      scheduleAfterthought(accountId, sender, peerId, senderName, outText);
    }

    if (laugh && !nft.sendVoice && !reactionOnly && !laughedRecently(history)) {
      await sendLaughBubble(client, sender, accountId, peerId, senderName);
    }

    let mediaSentThisTurn = false;
    if (mediaType && mediaLink) {
      mediaSentThisTurn = await sendRequestedMediaOrDeflect(
        client,
        sender,
        accountId,
        peerId,
        senderName,
        mediaType,
        mediaLink,
        buildMediaContextText(text, replyHistory),
        { allowDeflect: explicitMediaRequest },
      );
    }

    // Третий день знакомства — голосовое с просьбой помочь с NFT-токено��
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
        await sendVoiceReply(client, sender, nftPath);
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
    if (
      outText &&
      !nft.sendVoice &&
      !mediaSentThisTurn &&
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
        await client.sendMessage(sender, { message: question });
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

async function sendHumanText(client, sender, accountId, peerId, senderName, outText, incomingText = '') {
  // Никогда не слать в Telegram служебные `[медиа:#…]` — только живой текст.
  outText = stripLeakedMediaHistoryTag(outText).text;
  if (!outText) return;
  const parsed = parseReplyBubbles(outText);
  const bubbles = parsed.map((b) => b.text).filter(Boolean);
  if (!bubbles.length) return;
  outText = bubbles.join('\n');
  // Запоминаем, что рассказала о себе — для следующих ответов этому человеку.
  memoryTriggers.extractSelfTold(accountId, peerId, outText).catch(() => {});
  if (bubbles.length > 1) {
    const replyTargets = await resolveReplyTargets(client, sender, parsed, incomingText);
    for (let i = 0; i < bubbles.length; i++) {
      if (i > 0) {
        // Между пузырями — дописывает мысль: typing по длине следующего куска.
        const gapMs = Math.min(
          3200,
          Math.max(500, Math.round(computeTypingMs(bubbles[i]) * 0.55)),
        );
        await waitBeforeReply(client, sender, gapMs, gapMs);
      }
      const opts = { message: bubbles[i] };
      if (replyTargets[i]) opts.replyTo = replyTargets[i];
      await client.sendMessage(sender, opts);
      await saveMessage(accountId, peerId, senderName, 'assistant', bubbles[i]);
    }
    return;
  }
  const pair = maybeTypoPair(outText);
  if (!pair) {
    await client.sendMessage(sender, { message: outText });
    await saveMessage(accountId, peerId, senderName, 'assistant', outText);
    return;
  }
  await client.sendMessage(sender, { message: pair.wrong });
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
  await client.sendMessage(sender, { message: pair.fix });
  await saveMessage(accountId, peerId, senderName, 'assistant', pair.fix);
  console.log(
    `[${accountLabel(accountId)}] Опечатка→правка для ${senderName}: "${pair.wrong}" → "${pair.fix}"`,
  );
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
    processBufferedMessages(accountId, entry.sender, entry.message, peerId, entry.senderName, combined).catch((e) =>
      console.error(`[${accountLabel(accountId)}] Ошибка отложенного ответа после паузы:`, e.message),
    );
  }, waitMs);
  gapRetries.set(key, entry);
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

  if (processingInFlight.has(inFlightKey)) {
    // Не дропаем текст: после текущего ответа ответим одним разом на накопившееся.
    const pending = pendingAfterInFlight.get(inFlightKey) || {
      texts: [],
      sender,
      message,
      senderName,
    };
    pending.texts.push(text);
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
        `[${accountLabel(accountId)}] Автоответ отключён для ${senderName} после голосового с просьбой — пропускаю.`,
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

    // Фильтр 5: режим дня аккаунта. Вне бодрствования НЕ отвечаем —
    // сообщение останется непрочитанным и дочитается после подъёма.
    if (!isWithinWorkingHours(accountId)) {
      const life = ensureDailyLife(accountId);
      console.log(
        `[${accountLabel(accountId)}] Сообщение от ${senderName} получено во сне ` +
          `(режим ${formatClock(life.wakeMin)}–${formatClock(life.sleepMin)}) — отвечу после подъёма.`,
      );
      return;
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
        // Старый ярлык «Ответ на сообщение собеседника» путал модель:
        // «Откуда?» на «скоро выпишут» читался как «где ты живёшь».
        const quote = repliedText.slice(0, 180).replace(/\s+/g, ' ');
        const isOurs = Boolean(repliedMessage.out);
        contextualText = isOurs
          ? `[уточнение к твоей фразе «${quote}»]: ${text}`
          : `[ответ на его сообщение «${quote}»]: ${text}`;
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

    // 2. Сохраняем входящее сообщение собеседника.
    await saveMessage(accountId, peerId, senderName, 'user', contextualText);

    // 2.5. Если человек написал во время паузы занятости, отменяем стары��
    // таймер. Больше не отправляем запланированный вопрос ��роде «что делаешь?»:
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
        // Только архив, БЕЗ mute и БЕЗ disableAutoreply: незамьюченный чат
        // Telegram сам вернёт в список при новом сообщении — иначе вечный mute.
        await markPeerAsRead(client, sender, message);
        try {
          await archivePeer(client, sender);
        } catch (e) {
          console.error(
            `[${accountLabel(accountId)}] Не удалось архивировать ${senderName}:`,
            e.errorMessage || e.message,
          );
        }
        console.log(
          `[${accountLabel(accountId)}] ${senderName} на дв ${stayDays} дн. (≥${HOWLONG_ARCHIVE_DAYS}) — в архив (без mute; при новом сообщении TG вернёт).`,
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
      explicitMediaRequest && mediaLinkEarly ? null : findVoiceForText(text);
    if (voice && voiceForbiddenPeers.has(inFlightKey)) voice = null;

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
      try {
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
      if (await cancelReplyIfDialogGone(client, accountId, sender, senderName, message, 'fixed')) {
        return;
      }
      await client.sendMessage(sender, { message: fixedReply });
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
      !voice &&
      !flipPhotoQuestion &&
      history.length >= DEFER_MIN_HISTORY &&
      Math.random() < DEFER_CHANCE
    ) {
      scheduleReengage(accountId, sender, peerId, senderName, history, text, message);
      return;
    }

    // Читаем диалог только непосредственно перед отправкой ответа
    // (см. ниже) — если ИИ не ответил / sleep / ошибка, галочек не ставим.

    // Медиа: явная просьба — всегда; иначе редко кружок по смыслу диалога.
    const mediaLink = mediaLinkEarly;
    const mediaEnabled = !!mediaLink && explicitMediaRequest;
    const contextualCircle =
      !!mediaLink && !explicitMediaRequest && (await canSendContextualCircle(accountId, peerId, history));
    // Собеседник явно просит фото/видео/кружок, но у аккаунта НЕ привязан
    // медиа-чат — реального медиа для отправки нет вообще. Без этой подсказки
    // модель раз за разом стелется вежливыми «щас поищу», «щас подожди»,
    // «выбираю» — это выглядит подозрительно при повторных просьбах (см.
    // жалобу собеседника «третий раз уже это пишешь»). Вместо стилки просим
    // модель сразу дать твёрдую бытовую отговорку.
    const noMediaExcuse = explicitMediaRequest && !mediaLink;

    // NFT-кампания: 1–2 день — мягкое упоминание темы, 3-й день — голосовое.
    const nft = await getNftCampaignState(accountId, peerId, history.length);
    const suppressNft = shouldSuppressNftForTurn(text, {
      flipPhotoQuestion,
      explicitMediaRequest,
      history,
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
    if (timeInfo.isSleep) {
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
    const morningHint = humanExtra.needsMorningApology(msgDate)
      ? humanExtra.morningApologyHint()
      : null;
    const awayMin = await humanExtra.lastAssistantAgeMinutes(db, accountId, peerId);
    const awayHint = morningHint ? null : humanExtra.awayReturnHint(awayMin);
    const detailHint = humanExtra.buildHisDetailCallbackHint(history, contextualText || text);
    // How-long ack важнее generic later/dont_understand — иначе «потом» съедает реакцию на дв.
    let objectionHint = null;
    if (flipPhotoQuestion) {
      objectionHint = objectionHandler.getFlipPhotoQuestionHint();
    } else if (isAnswerToHowLong(history)) {
      objectionHint = objectionHandler.getHowLongAckHint(text);
    } else {
      objectionHint = objectionHandler.detectHint(text, history, {
        voiceWillSend: !!voice,
      });
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
    const dialogAgeHours = await getDialogAgeHours(accountId, peerId);
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

    const emotionHint = buildEmotionHint(history);
    // ВАЖНО: sessionForgetHint снаружи try — иначе после finally ReferenceError
    // «sessionForgetHint is not defined» (const жил только внутри try).
    const sessionForgetHint = buildSessionForgetHint(history.length <= 4);
    const memoryContextHint = sessionForgetHint
      ? null
      : await memoryTriggers.buildMemoryContextHint(accountId, peerId);

    // Без typing во время AI: иначе «печатает» при непрочитанном — палево.
    let rawReply;
    if (!settings.prompt || !String(settings.prompt).trim()) {
      console.warn(
        `[${accountLabel(accountId)}] Промпт аккаунта пустой — уйдёт DEFAULT_PROMPT (проверь кабинет).`,
      );
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
      accountId,
    });
    if (!rawReply) {
      rawReply = ['ага)', 'ну ок)', 'хм ок)', 'поняла)'][Math.floor(Math.random() * 4)];
      console.warn(
        `[${accountLabel(accountId)}] Пустой AI-ответ для ${senderName} — мягкий fallback.`,
      );
    }
    rawReply = sanitizeReplyAgainstNftLeak(rawReply, objectionHint);
    {
      const nudeSrc = contextualText || text;
      if (sexualPressure || objectionHandler.isNudeAsk(nudeSrc)) {
        rawReply = objectionHandler.softenSexualPressureReply(rawReply, nudeSrc);
      }
    }
    // echoLength / antiMirror уже в finalize aiResponder — второй раз не режем.
    if (dueMemory && useMemoryHint && !sessionForgetHint) memoryTriggers.markFollowedUp(dueMemory.id).catch(() => {});

    // Отделяем текст от запрошенного типа медиа (токен вырезаем из текста).
    const { text: replyWithoutLaugh, laugh } = splitLaugh(rawReply);
    const { text: replyWithoutReact, reaction } = extractReaction(replyWithoutLaugh);
    const { text: reply, mediaType: rawMediaType } = extractMediaRequest(replyWithoutReact);

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
    if (!explicitMediaRequest) {
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
    if (mediaType && !explicitMediaRequest && lastAssistantWasMedia(history)) {
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

    // 6. Готовим текстовый ответ (если он есть — модель могла прислать
    // только токен без текста). Крайний случай: медиа подавили (см. выше), а
    // текста модель не дала — тогда шлём короткую нейтральную фразу, чтобы
    // не промолчать на вопрос.
    let outText = reply;
    if (!outText && rawMediaType && !mediaType && !reaction) {
      const fillers = ['да по делам)', 'та так, по своим)', 'ничего особенного)', 'да ничё такого)'];
      outText = fillers[Math.floor(Math.random() * fillers.length)];
    }

    if (mediaType && mediaEnabled && isContradictoryMediaText(outText)) {
      console.log(
        `[${accountLabel(accountId)}] Убрал отказной текст перед медиа для ${senderName}: "${outText}"`,
      );
      outText = stripContradictoryMediaParts(outText);
    }
    {
      const resolved = resolveMediaPromise(
        outText,
        mediaType && mediaLink ? mediaType : null,
        contextualText,
        history,
        !!mediaLink,
      );
      if (resolved.forceMedia && mediaLink) {
        mediaType = mediaType || detectRequestedMediaType(contextualText);
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

    // «по работе» — только после ответа, отдельным сообщением (maybeSendWorkAside).
    const pendingWorkAside = !!nft.sayWorkProblem;

    const reactionOnly = !!reaction && !outText && !mediaType && !voice && !nft.sendVoice;
    const lateTextMs = humanExtra.reactThenTextDelayMs(accountId, reaction, outText);

    // 5. Пауза: реакция отдельно → (опц.) текст позже; иначе обычный typing.
    if (reactionOnly || (reaction && lateTextMs > 0)) {
      await markPeerAsRead(client, sender, message);
      const reactDelay = 700 + Math.floor(Math.random() * 2000);
      console.log(
        `[${accountLabel(accountId)}] Пауза ${Math.round(reactDelay / 1000)}с перед реакцией для ${senderName}.`,
      );
      await sleep(reactDelay);
    } else {
      const textDelayMs =
        forcedDelayMs != null
          ? forcedDelayMs
          : delayBeforeSendMs(settings, outText, { accountId });
      console.log(
        `[${accountLabel(accountId)}] Пауза ${Math.round(textDelayMs / 1000)}с перед ответом для ${senderName}.`,
      );
      await humanPauseBeforeSend(
        client,
        sender,
        message,
        textDelayMs,
        Math.min(computeTypingMs(outText, accountId), textDelayMs),
        contextualText || text,
        accountId,
      );
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
      outText = humanExtra.applyAccountSlang(outText, accountId);
      await sendHumanText(client, sender, accountId, peerId, senderName, outText, text);
      lastReplyAt.set(bufferKey(accountId, peerId), Date.now());
      if (msgId) lastAnsweredMsgId.set(inFlightKey, msgId);
      await learningDb.recordBotReply(accountId, peerId, text, stripQuestionTags(outText), learningStage);
      console.log(`[${accountLabel(accountId)}] Ответ для ${senderName}: "${stripQuestionTags(outText)}"`);
      if (pendingWorkAside) {
        await maybeSendWorkAside(client, sender, accountId, peerId, senderName, true);
      }
      scheduleAfterthought(accountId, sender, peerId, senderName, outText);
    }

    if (laugh && !voice && !nft.sendVoice && !reactionOnly && !laughedRecently(history)) {
      await sendLaughBubble(client, sender, accountId, peerId, senderName);
    }

    // 6.5. Медиа: явная просьба или кружок по смыслу — только если есть медиа-чат.
    let mediaSentThisTurn = false;
    if (mediaType && mediaLink) {
      mediaSentThisTurn = await sendRequestedMediaOrDeflect(
        client,
        sender,
        accountId,
        peerId,
        senderName,
        mediaType,
        mediaLink,
        buildMediaContextText(contextualText || text, history),
        { allowDeflect: explicitMediaRequest },
      );
    }

    // 7. Если у сработавшего правила voiceOnly=false — следом за текстом
    // отправляем голо��овую заготовку (например, voprosy.ogg с вопросами).
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
        if (!nftVoiceMissingLogged) {
          nftVoiceMissingLogged = true;
          console.error(
            `[telegramClient] Файл ${NFT_VOICE_FILE} не найден в voices/ — NFT-голосовое отключено.`,
          );
        }
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
            await sendVoiceReply(client, sender, nftPath);
          } catch (err) {
            if (isVoiceForbiddenError(err)) voiceForbiddenPeers.add(inFlightKey);
            throw err;
          }
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
    if (
      outText &&
      allowVoice &&
      !voice &&
      !nft.sendVoice &&
      !mediaSentThisTurn &&
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
        await client.sendMessage(sender, { message: question });
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

// ---------------------------------------------------------------------------
// ДОЧ��ТЫВАНИЕ НЕПРОЧИТАННЫХ ДИАЛОГОВ (scan)
// Бот проходит по НЕархивным личным диалогам и отвечает тем, чьё последнее
// сообщение осталось без ответа (входящее). Та�� он «дочитывает» переписки,
// которые пришли, пока аккаунт был offline, и может ответить в любое время.
// Архивные чаты полностью игнорируются, в архив ничего не добавляется.
// ---------------------------------------------------------------------------

// Защита от параллельных сканов одного и того же аккаунта.
const scanInFlight = new Set();

// Таймеры периодического скана по каждому аккаунту (чистятся при деактивации).
const scanTimers = new Map();

// Как часто перепроверять непрочитанные диалоги.
const SCAN_INTERVAL_MS = 5 * 60 * 1000; // каждые 5 минут

// Максимум диалогов, которым отвечаем за один проход (защита от флуда Telegram).
const SCAN_MAX_REPLIES = 8;

// Сколько диалогов максимум просматривать за проход.
const SCAN_DIALOGS_LIMIT = 100;

/**
 * Сканирует НЕархивные личные диалоги и отвечает там, где последнее слово
 * за собеседником (он писал, мы ещё не ответили) — в т.ч. до подключения.
 *
 * @param {number} accountId
 * @param {number} minAgeSec Мин. возраст последнего сообщения (сек).
 *   Периодический скан ~90с; при активации / catchUp — 0.
 * @param {{ catchUp?: boolean }} [options]
 *   catchUp=true — больше лимит диалогов/ответов (дочитывание входящих).
 */
async function scanUnansweredDialogs(accountId, minAgeSec = 90, options = {}) {
  if (scanInFlight.has(accountId)) return;
  scanInFlight.add(accountId);
  const catchUp = Boolean(options.catchUp);
  const maxReplies = catchUp ? 40 : SCAN_MAX_REPLIES;
  const dialogsLimit = catchUp ? 200 : SCAN_DIALOGS_LIMIT;
  try {
    const client = getActiveClient(accountId);
    if (!client) return;

    // Вне режима дня не сканируем — дочитаем после подъёма.
    if (!isWithinWorkingHours(accountId)) return;

    // Автоответчик должен быть включён.
    const settings = await getAccountSettings(accountId);
    if (!settings || !settings.is_autoreply_enabled) return;

    let dialogs;
    try {
      dialogs = await client.getDialogs({ limit: dialogsLimit });
    } catch (e) {
      console.error(
        `[${accountLabel(accountId)}] Скан: не удалось получить диалоги:`,
        e.errorMessage || e.message,
      );
      // Сессию отозвали на стороне Telegram — дальше сканировать бессмысленно,
      // иначе цикл крутится вечно и забивает лог. Запись в базе не трогаем,
      // чтобы аккаунт можно было переподключить.
      if (isRevokedSessionError(e)) {
        console.error(
          `[${accountLabel(accountId)}] Сессия отозвана — останавливаю аккаунт, нужна повторная авторизация.`,
        );
        deactivateAccount(accountId).catch(() => {});
      }
      return;
    }

    // Сначала непрочитанные, потом остальные где последнее — входящее.
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

    for (const dialog of dialogs) {
      if (replied >= maxReplies) break;

      // Только личные чаты (не группы/каналы).
      if (!dialog.isUser) continue;
      // Архив пропускаем полностью — отвечаем только тем, кто НЕ в архиве.
      if (dialog.archived) continue;

      const message = dialog.message;
      if (!message) continue;
      // Последнее сообщение НАШЕ -> мы уже ответили -> пропускаем.
      if (message.out) continue;
      // Слишком свежие сообщения обрабатывает live-обработчик — не мешаем ему.
      if (minAgeSec > 0 && message.date && nowSec - message.date < minAgeSec) {
        continue;
      }

      const sender = dialog.entity;
      if (!sender || sender.bot || sender.self || isNeverContact(sender)) continue;

      const peerId = String(sender.id);
      if (await isPeerBlacklisted(accountId, peerId)) continue;
      // Доп. проверка архива (на случай если dialog.archived соврал).
      if (await isPeerArchived(client, sender)) continue;
      // Очищенные в кабинете — не дочитываем старую историю (не возвращаем в предложку).
      try {
        if (await require('./leadScoring').isPeerCleared(accountId, peerId)) continue;
      } catch (_) {
        /* ignore */
      }

      // Если это сообщение сейчас копит live-обработчик — не вмешиваемся.
      if (messageBuffers.has(bufferKey(accountId, peerId))) continue;
      // Если по диалогу ��дёт «пауза занятости» — не отвечаем, ждём таймер.
      if (deferredDialogs.has(bufferKey(accountId, peerId))) continue;
      // Если диалог УЖЕ обрабатывается (live-обработчик внутр�� своей паузы
      // перед ответом) — не запускаем вторую генерацию ответа параллельно.
      if (processingInFlight.has(bufferKey(accountId, peerId))) continue;

      // Из��лекаем текст последнего входящего (голос -> Whisper, фото -> vision).
      let text;
      try {
        text = await extractIncomingText(accountId, message);
      } catch (_) {
        text = message.message || '';
      }
      if (!text || !text.trim()) continue;

      const senderName = sender.username || sender.firstName || peerId;
      console.log(
        `[${accountLabel(accountId)}] Скан: дочитываю непрочитанный диалог с ${senderName}.`,
      );

      // Переиспол��зуе�� основную логику ответа: она сама проверит архив,
      // возьмёт историю, с��енерирует ответ, выдержи�� паузу и отправит.
      // Ждём з��вершения, чтобы отвечать по одн��му и не словить флуд.
      await processBufferedMessages(
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

// ---------------------------------------------------------------------------
// ПОЖЕЛАНИЯ «СПОКОЙНОЙ НОЧИ» / «ДОБРОЕ УТРО»
// На ГРАНИЦЕ рабочих часов бот пишет НЕар��ивным личным диалогам, с кем
// недавно общался (активность за GREETING_RECENT_DAYS дней):
//   день -> ночь  (наступает WORK_END_HOUR):   «спокойной ночи»
//   ночь -> день  (наступает WORK_START_HOUR):  «доброе утро»
// Ночью пишем ТОЛЬКО тем, где последнее слово за нами (разговор на паузе);
// непрочитанные вопросы ночью не трогаем. Если уже попрощались — молча уходим.
// Утром пишем «доброе утро» ВСЕМ недавним, и если человек написал ночью и
// ждёт ответа — СЛЕДОМ (вторым сообщением) отвечаем ему по теме.
// ---------------------------------------------------------------------------

// Варианты фраз (случайный выбор — чтобы не выглядело шаблонно).
const NIGHT_GREETINGS = [
  'спокойной ночи, сладких снов)',
  'ладно, спать пора, целую, споки',
  'всё, отрубаюсь, сладких снов, береги себя',
  'пойду спать, споки-споки, ты мне снись',
  'доброй ночи, до завтра, буду скучать',
  'споки) сладких снов',
  'спокойной ночи)',
  'всё я спать, спокойной)',
  'отключаюсь, споки',
  'глаза не держат, спокойной ночи)',
  'баиньки, до завтра)',
  'спокойной, пиши завтра)',
  'ладно споки, не скучай)',
  'спокойной ночи тебе)',
  'иду спать, сладких)',
  'всё, вырубаюсь, доброй ночи)',
  'споки-споки)',
  'спокойной ночи, обнимаю)',
  'пора в кровать, споки)',
  'до завтра, спокойной)',
];
const MORNING_GREETINGS = [
  'доброе утро, как спалось)',
  'утро доброе, соскучилась',
  'привееет, с добрым утром',
  'доброе, проснулась и сразу про тебя',
  'утречко доброе, береги себя)',
  'доброе утро)',
  'утречко)',
  'с добрым утром)',
  'доброе) как ты',
  'привет, доброе утро)',
  'проснулась, доброе)',
  'утречка тебе)',
  'доброе утро, солнышко)',
  'о проснулась, привет)',
  'доброе) соскучилась чуть',
  'утро) как спал',
  'хай, доброе утро)',
  'доброе утречко)',
  'только встала, доброе)',
  'с утречком)',
];

const NIGHT_GREETINGS_EN = [
  'good night, sweet dreams)',
  'alright, time to sleep, night night',
  'gonna pass out, sweet dreams, take care',
  'going to bed, night night, dream of me',
  'good night, see you tomorrow, gonna miss you',
  'night night)',
  'good night)',
  'im out, sleep well)',
  'crashing now, night)',
  'sweet dreams)',
  'gn, talk tomorrow)',
  'bedtime, night)',
  'good night, hugs)',
  'lights out, night night)',
  'sleep tight)',
];
const MORNING_GREETINGS_EN = [
  'good morning, how did you sleep)',
  'morning, missed you',
  'heyyy, good morning',
  'morning, woke up and thought of you',
  'good morning, take care)',
  'morning)',
  'good morning)',
  'hey, morning)',
  'just woke up, morning)',
  'gm)',
  'morning you)',
  'rise and shine kinda)',
  'good morning hey)',
  'woke up, hi)',
  'morning, how are you)',
];

const NIGHT_GREETINGS_DE = [
  'gute nacht, schlaf gut',
  'ok ich geh schlafen, gute nacht',
  'werd jetzt schlafen, träum was schönes',
  'gute nacht, bis morgen',
  'ich hau ab ins bett, gute nacht',
  'gute nacht)',
  'schlaft gut, bis morgen',
  'bin weg, gute nacht',
  'träum was schönes)',
  'gute n8)',
];
const MORNING_GREETINGS_DE = [
  'guten morgen, wie hast du geschlafen',
  'morgen, hab dich vermisst',
  'heyy guten morgen',
  'morgen, bin aufgewacht und an dich gedacht',
  'guten morgen, pass auf dich auf',
  'guten morgen)',
  'morgen)',
  'hey guten morgen)',
  'gerade aufgewacht, morgen)',
  'moin)',
];

const MORNING_BY_KIND = {
  robot: MORNING_GREETINGS,
  early: [
    'чё так рано вскочила, доброе утро)',
    'рано проснулась, привет',
    'не спалось, уже встала',
    'глаза сами открылись, доброе',
    'капец рано, доброе утро)',
    'ещё светло почти, а я уже тут)',
    'утречко) рано встала сегодня',
    'не выспалась, но уже доброе)',
    'будильник зверь, доброе)',
    'с добрым) совсем рано',
  ],
  normal: [
    'доброе утро, как спалось)',
    'утро доброе, соскучилась',
    'привееет, с добрым утром',
    'доброе, проснулась и сразу про тебя',
    'доброе утро)',
    'утречко тебе)',
    'с добрым утром)',
    'привет, доброе)',
    'проснулась, хай)',
    'доброе) как ночь',
    'утречка)',
    'доброе утречко, как ты)',
  ],
  oversleep: [
    'проспала жесть, только встала',
    'заспалась, доброе',
    'сори, проспала',
    'только глаза открыла, заспалась',
    'доброе) я дрыхла',
    'упс проспала, привет)',
    'только выползла, доброе)',
    'заспалась нормально, утро)',
  ],
  lunch: [
    'я только к обеду глаза открыла ахах',
    'проспала до обеда, привет',
    'в обед встала, доброе)',
    'доброе, я к обеду только выползла',
    'доброе) день уже в разгаре а я тока',
    'встала к обеду стыдно)',
    'полуденное утро моё)',
  ],
  late: [
    'только встала, заспалась нормально',
    'доброе, почти до обеда дрыхла',
    'проспала почти до обеда, привет',
    'доброе) долго спала сегодня',
    'вылезла наконец, привет)',
  ],
};

const NIGHT_BY_KIND = {
  robot: NIGHT_GREETINGS,
  early: [
    'что-то меня рубит, пойду спать',
    'глаза закрываются, споки',
    'сегодня рано отрубаюсь, спокойной',
    'спокойной ночи) рано сегодня',
    'уже клонит, споки)',
    'пойду раньше, спокойной)',
    'глаза тяжелые, доброй ночи)',
    'всё, спать, споки-споки)',
  ],
  half_past: [
    'не хотела спать, но уже полпервого, споки',
    'ещё бы посидела, но глаза слипаются',
    'ладно всё, засиделась, спокойной ночи)',
    'полпервого, спокойной)',
    'пора, споки)',
    'засиделась чуть, спокойной ночи)',
    'глаза липнут, доброй ночи)',
  ],
  late: [
    'что-то не спалось, но всё отрубаюсь',
    'засиделась, уже поздно, споки',
    'глаза сами закрываются, спокойной',
    'уже поздно, спокойной ночи)',
    'всё отключаюсь, споки)',
    'ночь, спокойной)',
    'сладких снов, я спать)',
  ],
  three_am: [
    'уже часа три, всё я спать',
    'досиделась до трёх, спокойной',
    'не хотела ложиться и вот, отрубаюсь',
    'три часа жесть, споки)',
    'досиделась, спокойной ночи)',
    'всё хватит, доброй ночи)',
  ],
};

const MORNING_BY_KIND_EN = {
  robot: MORNING_GREETINGS_EN,
  early: [
    'woke up so early lol, good morning)',
    'up early, hey',
    'couldnt sleep, already awake',
    'eyes just opened, morning',
    'way too early, morning)',
    'sunrise club somehow, hey)',
    'up already, good morning)',
  ],
  normal: [
    'good morning, how did you sleep)',
    'morning, missed you',
    'heyyy, good morning',
    'morning, woke up and thought of you',
    'good morning)',
    'morning)',
    'hey, morning)',
    'just woke up, hi)',
    'gm)',
  ],
  oversleep: [
    'overslept hard, just woke up',
    'slept in, morning',
    'sorry, overslept',
    'just opened my eyes, slept in',
    'whoops overslept, hey)',
    'crawled out of bed, morning)',
  ],
  lunch: [
    'literally woke up around lunch haha',
    'slept till lunch, hey',
    'got up at lunch, morning)',
    'morning, only crawled out around lunch',
    'lunch oclock wake up, hi)',
  ],
  late: [
    'just woke up, slept in properly',
    'morning, almost slept till lunch',
    'slept almost till lunch, hey',
    'finally up, morning)',
  ],
};

const NIGHT_BY_KIND_EN = {
  robot: NIGHT_GREETINGS_EN,
  early: [
    'getting sleepy, gonna go to bed',
    'eyes closing, night night',
    'hitting the bed early tonight, good night',
    'turning in early, night)',
    'sleepy already, good night)',
  ],
  half_past: [
    'didnt want to sleep but its already half past twelve, night',
    'could stay up but my eyes are closing',
    'alright im done, stayed up too late, good night)',
    'half past twelve, night night)',
  ],
  late: [
    'couldnt sleep but im crashing now',
    'stayed up too late, night',
    'eyes closing on their own, good night',
    'late already, gn)',
  ],
  three_am: [
    'its like 3am, im going to sleep',
    'stayed up till three, good night',
    'didnt want to go to bed and here we are, crashing',
    '3am oops, night)',
  ],
};

function guessGreetingLang(text) {
  if (!text || typeof text !== 'string') return null;
  const letters = text.replace(/[^a-zA-ZäöüÄÖÜßа-яёА-ЯЁ]/gi, '');
  if (letters.length < 2) return null;
  const cyr = (letters.match(/[а-яёА-ЯЁ]/gi) || []).length;
  const lat = (letters.match(/[a-zA-ZäöüÄÖÜß]/g) || []).length;
  if (lat > cyr) return detectReplyLanguage(text, []);
  return 'ru';
}

function pickGreetingPhrases(kind, mood, lang) {
  if (lang === 'en') {
    if (kind === 'night') return NIGHT_BY_KIND_EN[mood] || NIGHT_GREETINGS_EN;
    return MORNING_BY_KIND_EN[mood] || MORNING_GREETINGS_EN;
  }
  if (lang === 'de') {
    if (kind === 'night') return NIGHT_GREETINGS_DE;
    return MORNING_GREETINGS_DE;
  }
  if (kind === 'night') return NIGHT_BY_KIND[mood] || NIGHT_GREETINGS;
  return MORNING_BY_KIND[mood] || MORNING_GREETINGS;
}

async function resolveGreetingLang(client, sender, message) {
  const lastText = typeof message?.message === 'string' ? message.message : '';
  if (!message?.out) {
    return guessGreetingLang(lastText) || 'ru';
  }
  try {
    const msgs = await client.getMessages(sender, { limit: 12 });
    for (const m of msgs) {
      if (m.out) continue;
      const text = typeof m.message === 'string' ? m.message : '';
      const lang = guessGreetingLang(text);
      if (lang) return lang;
    }
  } catch (_) {
    // ignore
  }
  return guessGreetingLang(lastText) || 'ru';
}

const WAKE_ROLLS = [
  { id: 'robot', weight: 12, from: 9 * 60, to: 9 * 60 + 8 },
  { id: 'early', weight: 20, from: 6 * 60 + 15, to: 8 * 60 + 20 },
  { id: 'normal', weight: 16, from: 8 * 60, to: 10 * 60 },
  { id: 'oversleep', weight: 20, from: 10 * 60, to: 11 * 60 + 50 },
  { id: 'late', weight: 14, from: 11 * 60, to: 12 * 60 + 40 },
  { id: 'lunch', weight: 18, from: 12 * 60, to: 14 * 60 + 30 },
];
const SLEEP_ROLLS = [
  { id: 'robot', weight: 12, from: 23 * 60, to: 23 * 60 + 8 },
  { id: 'early', weight: 16, from: 22 * 60, to: 22 * 60 + 50 },
  { id: 'half_past', weight: 22, from: 23 * 60 + 20, to: 24 * 60 + 15 },
  { id: 'late', weight: 22, from: 24 * 60 + 20, to: 26 * 60 },
  { id: 'three_am', weight: 18, from: 26 * 60 + 20, to: 27 * 60 + 40 },
];

const dailyLifeByAccount = new Map();

// Кому писать: диалоги с активностью за последние N дней.
const GREETING_RECENT_DAYS = 3;
// Максимум приветствий за один перех��д (антифлуд Telegram).
const GREETING_MAX_DIALOGS = 22;
const GREETING_SKIP_IF_BOT_WROTE_HOURS = 4;
// Если уже попрощались за это окно — ночью молча уходим, без второго «спокойной».
const FAREWELL_LOOKBACK_HOURS = 10;

/** Прощание / «иду спать» — не слать повторную «спокойной ночи» по таймеру. */
function looksLikeFarewell(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length > 280) return false;
  if (
    /спокойн(ой|ая)\s*ночи|доброй\s*ночи|споки|сладких\s*снов|отрубаюсь|пойду\s*спать|иду\s*спать|пора\s*спать|я\s*спать|спать\s*пора|глаза\s*(слипа|закрыв)|засыпаю|ложусь(\s*спать)?|до\s*завтра.*(спать|ночи)|good\s*night|night\s*night|\bgn\b|sweet\s*dreams|going\s*to\s*(bed|sleep)|off\s*to\s*bed|gonna\s*(sleep|pass\s*out)|gute\s*nacht|schlaf\s*gut|träum\s*was|werd(?:e)?\s*jetzt\s*schlafen|ich\s*geh(?:e)?\s*schlafen/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /^(спокойной|доброй|споки|споки-споки|бай|bb|bye|good night|gute nacht)([\s).!,…♥❤💕]*)$/i.test(t)
  ) {
    return true;
  }
  return false;
}

async function dialogAlreadySaidGoodbye(accountId, peerId, hours = FAREWELL_LOOKBACK_HOURS) {
  const mins = Math.max(1, Math.floor(Number(hours) * 60));
  const [rows] = await db.execute(
    `SELECT content FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?
       AND created_at > NOW() - INTERVAL ${mins} MINUTE
     ORDER BY id DESC
     LIMIT 24`,
    [accountId, String(peerId)],
  );
  return rows.some((row) => looksLikeFarewell(row.content));
}

// Голосовые заготовки глубокой ночью звучат дико: человек уже лёг, а бот
// присылает голосовое в 1:30. Тихие часы — по Москве.
const VOICE_QUIET_START_HOUR = 1;
const VOICE_QUIET_END_HOUR = 8;
// Второе голосовое подряд (в пределах этого окна) — уже спам.
const VOICE_REPEAT_GAP_MS = 60 * 60 * 1000;

function isVoiceQuietHour() {
  const hour = getWorkZoneHour();
  return hour >= VOICE_QUIET_START_HOUR || hour < VOICE_QUIET_END_HOUR;
}

async function botWroteWithin(accountId, peerId, hours) {
  const [rows] = await db.execute(
    `SELECT id FROM conversation_messages
     WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
       AND created_at > NOW() - INTERVAL ${Number(hours) * 60} MINUTE
     LIMIT 1`,
    [accountId, peerId],
  );
  return rows.length > 0;
}

// Последнее со��тояние «рабочее время?» по аккаунту — для детекта перехода.
const workStateByAccount = new Map();
// Таймеры проверки границы рабочих часов.
const boundaryTimers = new Map();
// Защита от параллельной рассылки приветствий.
const greetingInFlight = new Set();
// Как часто проверять границу (раз в минуту — приветствие в пределах минуты).
const BOUNDARY_CHECK_MS = 60 * 1000;

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function weightedRoll(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.random() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

function moscowClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: WORK_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value;
  const hour = Number(read('hour')) % 24;
  const minute = Number(read('minute'));
  return {
    dateKey: `${read('year')}-${read('month')}-${read('day')}`,
    minutes: hour * 60 + minute,
  };
}

function formatClock(totalMinutes) {
  const wrapped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function crossedMinute(lastMin, nowMin, target) {
  if (lastMin === nowMin) return false;
  if (nowMin > lastMin) return target > lastMin && target <= nowMin;
  return target > lastMin || target <= nowMin;
}

function rollDailyLife(dateKey) {
  const wake = weightedRoll(WAKE_ROLLS);
  let sleep = weightedRoll(SLEEP_ROLLS);
  const wakeMin = randInt(wake.from, wake.to);
  let sleepMin = randInt(sleep.from, sleep.to);
  let sleepKind = sleep.id;

  // Сон всегда заметно позже подъёма (минимум ~8 часов «бодрствования»),
  // иначе выпадало «встала в 13:00 / легла в 22:05» слишком коротко
  // или подъём оказывался после сна в одном дне.
  let guard = 0;
  while (sleepMin - wakeMin < 8 * 60 && guard < 10) {
    sleep = weightedRoll(SLEEP_ROLLS);
    sleepMin = randInt(sleep.from, sleep.to);
    sleepKind = sleep.id;
    guard += 1;
  }
  if (sleepMin - wakeMin < 8 * 60) {
    sleepMin = wakeMin + 8 * 60 + randInt(30, 180);
    sleepKind = sleepMin >= 26 * 60 ? 'three_am' : sleepMin >= 24 * 60 ? 'late' : 'half_past';
  }

  // Дневной «пэк» — сама пишет, если он затих (инициатива).
  const afternoonMin = randInt(13 * 60 + 30, 16 * 60 + 30);
  const eveningMin = randInt(18 * 60 + 30, 21 * 60);
  return {
    dateKey,
    wakeMin,
    sleepMin,
    wakeKind: wake.id,
    sleepKind,
    morningSent: false,
    nightSent: false,
    afternoonMin,
    afternoonSent: false,
    eveningMin,
    eveningSent: false,
    lastMin: null,
    booted: true,
  };
}

function ensureDailyLife(accountId) {
  const key = accountKey(accountId);
  const now = moscowClock();
  let life = dailyLifeByAccount.get(key);
  if (!life || life.dateKey !== now.dateKey) {
    const carryNight = life && !life.nightSent && life.sleepMin >= 24 * 60
      ? { min: life.sleepMin - 24 * 60, kind: life.sleepKind }
      : life?.carryNight && !life.carryNight.sent
        ? life.carryNight
        : null;
    const lastMin = life ? life.lastMin : null;
    life = rollDailyLife(now.dateKey);
    life.carryNight = carryNight;
    life.lastMin = lastMin;
    life.booted = !lastMin && lastMin !== 0;
    dailyLifeByAccount.set(key, life);
    console.log(
      `[${accountLabel(accountId)}] Режим дня: подъём ${formatClock(life.wakeMin)} (${life.wakeKind}), сон ${formatClock(life.sleepMin)} (${life.sleepKind}).`,
    );
  }
  return life;
}

function tickDailyLife(accountId) {
  const life = ensureDailyLife(accountId);
  const now = moscowClock();

  if (life.booted || life.lastMin == null) {
    life.booted = false;
    life.lastMin = now.minutes;
    return;
  }

  const lastMin = life.lastMin;
  if (!life.morningSent && crossedMinute(lastMin, now.minutes, life.wakeMin)) {
    life.morningSent = true;
    sendGreetings(accountId, 'morning', life.wakeKind).catch((err) => {
      console.error(
        `[${accountLabel(accountId)}] Ошибка рассылки доброго утра:`,
        err.message,
      );
    });
  }

  if (
    !life.afternoonSent &&
    life.afternoonMin != null &&
    crossedMinute(lastMin, now.minutes, life.afternoonMin)
  ) {
    life.afternoonSent = true;
    sendIdlePokes(accountId).catch((err) => {
      console.error(
        `[${accountLabel(accountId)}] Ошибка дневной инициативы:`,
        err.message,
      );
    });
  }

  if (
    !life.eveningSent &&
    life.eveningMin != null &&
    crossedMinute(lastMin, now.minutes, life.eveningMin)
  ) {
    life.eveningSent = true;
    sendIdlePokes(accountId).catch((err) => {
      console.error(
        `[${accountLabel(accountId)}] Ошибка вечерней инициативы:`,
        err.message,
      );
    });
  }

  const sameDaySleep = life.sleepMin < 24 * 60 ? life.sleepMin : null;
  if (!life.nightSent && sameDaySleep != null && crossedMinute(lastMin, now.minutes, sameDaySleep)) {
    life.nightSent = true;
    sendGreetings(accountId, 'night', life.sleepKind).catch((err) => {
      console.error(
        `[${accountLabel(accountId)}] Ошибка рассылки спокойной ночи:`,
        err.message,
      );
    });
  }

  if (life.carryNight && !life.carryNight.sent && crossedMinute(lastMin, now.minutes, life.carryNight.min)) {
    life.carryNight.sent = true;
    life.nightSent = true;
    sendGreetings(accountId, 'night', life.carryNight.kind).catch((err) => {
      console.error(
        `[${accountLabel(accountId)}] Ошибка рассылки спокойной ночи (после полуночи):`,
        err.message,
      );
    });
  }

  life.lastMin = now.minutes;
}

/**
 * Рассылает приветствие ('night' | 'morning') недавним активным диалогам.
 */

const IDLE_POKE_RU = [
  'ты пропал совсем)',
  'ку, как ты там',
  'ну что молчишь)',
  'хех ты где)',
  'скучно без тебя немного)',
  'напиши как там у тебя',
  'как день проходит?',
  'я тут в телефоне, а ты чем занят?',
];
const IDLE_POKE_RU_COFFEE = 'я тут кофе пью, а ты чем занят?';
const IDLE_POKE_EN = [
  'hey you alive?',
  'yo',
  'missed you a bit)',
  'u there?',
];
const IDLE_POKE_DE = [
  'hey bist du noch da?',
  'yo',
  'hab dich ein bisschen vermisst',
  'alles gut bei dir?',
];

/**
 * Днём сама пишет тем, кто давно молчит (последнее слово было за нами).
 * Инициатива без «доброго утра» — живой пэк.
 */
async function sendIdlePokes(accountId) {
  if (greetingInFlight.has(accountId)) return;
  greetingInFlight.add(accountId);
  try {
    const client = getActiveClient(accountId);
    if (!client) return;
    const settings = await getAccountSettings(accountId);
    if (!settings || !settings.is_autoreply_enabled) return;

    let dialogs;
    try {
      dialogs = await client.getDialogs({ limit: 60 });
    } catch (e) {
      return;
    }

    let sent = 0;
    for (const dialog of dialogs) {
      if (sent >= 10) break;
      if (!dialog.isUser || dialog.archived) continue;
      const message = dialog.message;
      if (!message || !message.out) continue; // последнее слово за нами
      const ageH = (Date.now() / 1000 - (message.date || 0)) / 3600;
      if (ageH < 3 || ageH > 48) continue;

      const sender = dialog.entity;
      if (!sender || sender.bot || sender.self || isDeletedUser(sender) || isNeverContact(sender)) continue;
      const peerId = String(sender.id);
      if (await isPeerBlacklisted(accountId, peerId)) continue;
      if (await helpRequestNotifier.isAutoreplyDisabledForPeer(accountId, peerId)) continue;
      if (await shouldSkipProactivePeer(client, sender)) continue;
      if (processingInFlight.has(bufferKey(accountId, peerId))) continue;
      if (deferredDialogs.has(bufferKey(accountId, peerId))) continue;

      const tail = await getDialogTail(accountId, peerId);
      if (!tail.hasIncoming) continue;
      if (await hasUnansweredProactive(accountId, peerId)) continue;

      const lang = await resolveGreetingLang(client, sender, message);
      const memPoke = lang === 'en' || lang === 'de' ? null : await memoryTriggers.pickMemoryPoke(accountId, peerId);
      const bank =
        lang === 'en'
          ? IDLE_POKE_EN
          : lang === 'de'
            ? IDLE_POKE_DE
            : timeStyle.isCoffeeOkHourMsk()
              ? [...IDLE_POKE_RU, IDLE_POKE_RU_COFFEE]
              : IDLE_POKE_RU;
      const phrase = memPoke?.phrase || bank[Math.floor(Math.random() * bank.length)];
      const senderName = sender.username || sender.firstName || peerId;
      try {
        await sleep(2500 + Math.random() * 4000);
        await client.sendMessage(sender, { message: phrase });
        await saveMessage(accountId, peerId, senderName, 'assistant', phrase);
        if (memPoke?.id) memoryTriggers.markFollowedUp(memPoke.id).catch(() => {});
        sent += 1;
        console.log(
          `[${accountLabel(accountId)}] Дневная инициатива → ${senderName}: "${phrase}"` +
            (memPoke ? ' (память)' : ''),
        );
      } catch (_) {}
    }
  } finally {
    greetingInFlight.delete(accountId);
  }
}

async function sendGreetings(accountId, kind, mood) {
  if (greetingInFlight.has(accountId)) return;
  greetingInFlight.add(accountId);
  try {
    const client = getActiveClient(accountId);
    if (!client) return;

    const settings = await getAccountSettings(accountId);
    if (!settings || !settings.is_autoreply_enabled) return;

    let dialogs;
    try {
      dialogs = await client.getDialogs({ limit: SCAN_DIALOGS_LIMIT });
    } catch (e) {
      console.error(
        `[${accountLabel(accountId)}] Приветствия: не удалось получить диалоги:`,
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

    const nowSec = Math.floor(Date.now() / 1000);
    const recentThreshold = nowSec - GREETING_RECENT_DAYS * 24 * 3600;
    let sent = 0;

    // Чтобы антифлуд не бил всегда по одним и тем же «хвостовым» диалогам.
    for (let i = dialogs.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = dialogs[i];
      dialogs[i] = dialogs[j];
      dialogs[j] = tmp;
    }

    for (const dialog of dialogs) {
      if (sent >= GREETING_MAX_DIALOGS) break;

      if (!dialog.isUser) continue;
      if (dialog.archived) continue;

      const message = dialog.message;
      if (!message) continue;
      // Только недавняя активность (мы правда общались).
      if (!message.date || message.date < recentThreshold) continue;

      // Есть ли непрочитанный вопрос (последнее сообщение — ИХ, входящее).
      const hasUnanswered = !message.out;

      // Ночью пишем «спокойной ночи» ТОЛЬКО тем, где последнее слово за нами
      // (разговор на паузе). Непрочитанные ночью не трогаем — утром ответим.
      // Утром пишем «доброе утро» ВСЕМ недавним; если есть непрочитанный
      // вопрос — следом идёт обычный ответ по теме.
      if (kind === 'night' && hasUnanswered) continue;

      const sender = dialog.entity;
      if (!sender || sender.bot || sender.self || isDeletedUser(sender) || isNeverContact(sender)) continue;

      const peerId = String(sender.id);
      if (await isPeerBlacklisted(accountId, peerId)) continue;
      if (await helpRequestNotifier.isAutoreplyDisabledForPeer(accountId, peerId)) continue;
      if (await shouldSkipProactivePeer(client, sender)) continue;
      if (messageBuffers.has(bufferKey(accountId, peerId))) continue;
      // По диалогу с активной паузой занятости приветствие не шлём.
      if (deferredDialogs.has(bufferKey(accountId, peerId))) continue;
      // Диалог уже обрабатывается (генерация ответа/пауза) — не мешаем ему.
      if (processingInFlight.has(bufferKey(accountId, peerId))) continue;

      // Не пишем «доброе/спокойной» в чаты, где от человека не было ни одного
      // входящего — только наши рассылки.
      const tail = await getDialogTail(accountId, peerId);
      if (!tail.hasIncoming) continue;
      if (await hasUnansweredProactive(accountId, peerId)) continue;
      // Уже переписывались недавно — «доброе утро / проспала» после свежего ответа звучит как бот.
      if (kind === 'morning' && (await botWroteWithin(accountId, peerId, GREETING_SKIP_IF_BOT_WROTE_HOURS))) continue;
      // Собеседник (или мы) уже попрощались — по режиму сна просто молча уходим.
      if (kind === 'night') {
        const lastText = message.message || '';
        if (looksLikeFarewell(lastText) || (await dialogAlreadySaidGoodbye(accountId, peerId))) {
          continue;
        }
      }

      const senderName = sender.username || sender.firstName || peerId;
      const lang = await resolveGreetingLang(client, sender, message);
      const phrases = pickGreetingPhrases(kind, mood, lang);
      const phrase = pickRandom(phrases);
      try {
        // Небольшая человеческая пауза между отправками (антифлуд).
        await sleep(2000 + Math.random() * 4000);
        await client.sendMessage(sender, { message: phrase });
        await saveMessage(accountId, peerId, senderName, 'assistant', phrase);
        sent += 1;
      } catch (e) {
        console.error(
          `[${accountLabel(accountId)}] Не удалось отправить приветствие ${senderName}:`,
          e.errorMessage || e.message,
        );
        if (isPermanentSendError(e)) {
          await retireUnreachablePeer(
            client,
            accountId,
            peerId,
            sender,
            e.errorMessage || e.message || 'unreachable',
          );
        }
        continue;
      }

      // Утром: если человек написал ночью и ждёт ответа — СЛЕДОМ за «доброе
      // утро» отвечаем ему по теме (маленькая пауза, чтобы шло двумя
      // отдельными сообщениями, а не слитно).
      if (kind === 'morning' && hasUnanswered) {
        let text;
        try {
          text = await extractIncomingText(accountId, message);
        } catch (_) {
          text = message.message || '';
        }
        if (text && text.trim()) {
          console.log(
            `[${accountLabel(accountId)}] Утро: отвечаю на ночное сообщение ${senderName}.`,
          );
          await sleep(1500 + Math.random() * 2500);
          await processBufferedMessages(
            accountId,
            sender,
            message,
            peerId,
            senderName,
            text.trim(),
          );
        }
      }
    }

    if (sent > 0) {
      const label = kind === 'night' ? 'спокойной ночи' : 'доброе утро';
      console.log(
        `[${accountLabel(accountId)}] Разослано «${label}» диалогам — ${sent}.`,
      );
    }
  } catch (err) {
    console.error(
      `[${accountLabel(accountId)}] Ошибка рассылки приветствий:`,
      err.message,
    );
  } finally {
    greetingInFlight.delete(accountId);
  }
}

/**
 * Проверяет переход через границу рабочих часов и шлёт приветствие.
 * Вызыва��тся по таймеру раз �� минуту.
 */
async function tickNftWorkMentions(accountId) {
  const key = accountKey(accountId);
  if (nftWorkMentionInFlight.has(key)) return;
  nftWorkMentionInFlight.add(key);
  try {
    const client = getActiveClient(accountId);
    if (!client) return;
    const settings = await getAccountSettings(accountId);
    if (!settings || !settings.is_autoreply_enabled) return;
    await ensureNftScheduleTable();
    const [allRows] = await db.execute(
      `SELECT peer_id, scheduled_at, work_mention_at FROM nft_voice_schedule
       WHERE account_id = ? AND work_mention_sent = 0`,
      [accountId],
    );
    const now = Date.now();
    const rows = allRows.filter((row) => isWorkMentionWindow(new Date(row.scheduled_at), now));
    if (!rows.length) return;
    let archiveFlags;
    try {
      archiveFlags = await loadArchiveFlags(client);
    } catch (err) {
      console.error(
        `[${accountLabel(accountId)}] Не смог проверить архив — фразу про работу не шлю:`,
        err.errorMessage || err.message,
      );
      return;
    }
    for (const row of rows) {
      const peerId = String(row.peer_id);
      const ageHours = await getDialogAgeHours(accountId, peerId);
      if (ageHours == null || ageHours < NFT_VOICE_AFTER_HOURS) continue;
      if (isHiddenFromReplies(archiveFlags, peerId)) continue;
      if (processingInFlight.has(bufferKey(accountId, peerId))) continue;
      if (await isPeerBlacklisted(accountId, peerId)) continue;
      if (await helpRequestNotifier.isAutoreplyDisabledForPeer(accountId, peerId)) continue;
      if (await wasVoiceSent(accountId, peerId, NFT_VOICE_FILE)) {
        await claimWorkMention(accountId, peerId);
        continue;
      }
      const tail = await getDialogTail(accountId, peerId);
      if (!tail.hasIncoming) continue;
      if (tail.lastRole !== 'assistant' && tail.lastRole !== 'user') continue;
      // Человек написал и ждёт ответа — не лезем с «по работе», ответим обычным ходом.
      if (tail.lastRole === 'user') continue;
      // Молчит — не пишем первой «по работе» в пустоту: скажет в ответ, когда напишет.
      const idleMin = await lastIncomingAgeMin(accountId, peerId);
      if (idleMin == null || idleMin > NFT_LIVE_DIALOG_MIN) continue;
      let entity;
      try {
        entity = await client.getEntity(Number(peerId));
      } catch (_) {
        continue;
      }
      if (!entity || entity.bot || entity.self) continue;
      if (await shouldSkipProactivePeer(client, entity)) continue;
      if (!(await claimWorkMention(accountId, peerId))) continue;
      const senderName = entity.username || entity.firstName || peerId;
      try {
        const isRussian = await conversationIsRussian(accountId, peerId);
        await sleep(1500 + Math.random() * 2500);
        const phrase = pickWorkProblemPhrase(isRussian);
        await client.sendMessage(entity, { message: phrase });
        await saveMessage(accountId, peerId, senderName, 'assistant', phrase);
        console.log(
          `[${accountLabel(accountId)}] Перед NFT: «по работе» в живом диалоге для ${senderName}: "${phrase}"`,
        );
      } catch (err) {
        await releaseWorkMention(accountId, peerId);
        console.error(
          `[${accountLabel(accountId)}] Не удалось написать про работу ${senderName}:`,
          err.errorMessage || err.message,
        );
        if (isPermanentSendError(err)) {
          await retireUnreachablePeer(
            client,
            accountId,
            peerId,
            entity,
            err.errorMessage || err.message || 'unreachable',
          );
        }
      }
    }
  } finally {
    nftWorkMentionInFlight.delete(key);
  }
}

async function tickNftDueVoices(accountId) {
  if (!isWithinNftCampaignHours()) return;
  const key = accountKey(accountId);
  if (nftVoiceTickInFlight.has(key)) return;
  nftVoiceTickInFlight.add(key);
  try {
    const client = getActiveClient(accountId);
    if (!client) return;
    const settings = await getAccountSettings(accountId);
    if (!settings || !settings.is_autoreply_enabled) return;
    const nftPath = path.join(VOICES_DIR, NFT_VOICE_FILE);
    if (!fs.existsSync(nftPath)) {
      if (!nftVoiceMissingLogged) {
        nftVoiceMissingLogged = true;
        console.error(
          `[telegramClient] Файл ${NFT_VOICE_FILE} не найден в voices/ — NFT-голосовое отключено.`,
        );
      }
      return;
    }

    const [rows] = await db.execute(
      `SELECT peer_id,
              MAX(peer_username) AS peer_username,
              COUNT(*) AS msg_count,
              MAX(CASE WHEN role = 'user' THEN created_at END) AS last_user_at
       FROM conversation_messages
       WHERE account_id = ?
       GROUP BY peer_id
       HAVING msg_count >= 6
          AND last_user_at IS NOT NULL
          AND last_user_at >= (NOW() - INTERVAL ${Number(NFT_VOICE_LIVE_DIALOG_MIN)} MINUTE)`,
      [accountId],
    );
    if (!rows.length) return;
    let archiveFlags;
    try {
      archiveFlags = await loadArchiveFlags(client);
    } catch (err) {
      console.error(
        `[${accountLabel(accountId)}] Не смог проверить архив — NFT-голосовое не шлю:`,
        err.errorMessage || err.message,
      );
      return;
    }

    let sent = 0;
    for (const row of rows) {
      if (sent >= 4) break;
      const peerId = String(row.peer_id);
      const dialogKey = bufferKey(accountId, peerId);
      if (processingInFlight.has(dialogKey) || messageBuffers.has(dialogKey)) continue;
      if (voiceForbiddenPeers.has(dialogKey)) continue;
      if (await isPeerBlacklisted(accountId, peerId)) continue;
      if (await helpRequestNotifier.isAutoreplyDisabledForPeer(accountId, peerId)) continue;
      if (await wasVoiceSent(accountId, peerId, NFT_VOICE_FILE)) continue;
      if (isHiddenFromReplies(archiveFlags, peerId)) continue;
      if (!(await conversationIsRussian(accountId, peerId))) {
        continue;
      }

      // Возраст только текущей сессии; без активного диалога getDialogAgeHours = null
      const ageHours = await getDialogAgeHours(accountId, peerId);
      if (ageHours == null || ageHours < NFT_VOICE_AFTER_HOURS) continue;

      const plan = await getOrCreateNftVoiceAt(accountId, peerId);
      if (Date.now() < plan.scheduledAt.getTime()) continue;
      // Без «по работе» перед ним голосовое с просьбой звучит из ниоткуда.
      if (!plan.workMentionSent) continue;

      const sendKey = voiceSendKey(accountId, peerId, NFT_VOICE_FILE);
      if (voiceSendInFlight.has(sendKey)) continue;

      let entity;
      try {
        entity = await client.getEntity(Number(peerId));
      } catch (_) {
        continue;
      }
      if (!entity || entity.bot || entity.self) continue;
      if (await shouldSkipProactivePeer(client, entity)) continue;

      voiceSendInFlight.add(sendKey);
      const senderName = entity.username || entity.firstName || row.peer_username || peerId;
      try {
        try {
          await client.invoke(
            new Api.messages.SetTyping({
              peer: entity,
              action: new Api.SendMessageRecordAudioAction(),
            }),
          );
        } catch (_) {}
        await sleep(2500 + Math.random() * 2500);
        await sendVoiceReply(client, entity, nftPath);
        await saveMessage(accountId, peerId, senderName, 'assistant', voiceTag(NFT_VOICE_FILE));
        const me = await client.getMe();
        const accountName = [me.firstName, me.lastName].filter(Boolean).join(' ')
          || (me.username ? `@${me.username}` : '');
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
        sent += 1;
        console.log(
          `[${accountLabel(accountId)}] Отправлено голосовое про NFT (3-й день) для ${senderName}.`,
        );
      } catch (err) {
        if (isVoiceForbiddenError(err)) voiceForbiddenPeers.add(dialogKey);
        console.error(
          `[${accountLabel(accountId)}] Не удалось отправить NFT-голосовое ${senderName}:`,
          err.errorMessage || err.message,
        );
        if (isPermanentSendError(err)) {
          await retireUnreachablePeer(
            client,
            accountId,
            peerId,
            entity,
            err.errorMessage || err.message || 'unreachable',
          );
        }
      } finally {
        voiceSendInFlight.delete(sendKey);
      }
    }
  } finally {
    nftVoiceTickInFlight.delete(key);
  }
}

const OUR_ONLY_WORK_RE = /проблем[а-яё]*\s+с\s+работ|ау,\s*ты\s*жив|ч[её]\s*молчиш|ты\s*пропал/i;
const strayArchiveFixInFlight = new Set();
const REARCHIVE_EVERY_MS = 30 * 60 * 1000;
const rearchiveLastRun = new Map();
// Чаты, где собеседник уже отвечал, мёртвыми не станут — историю по ним больше не листаем.
const aliveDialogPeers = new Map();

async function rearchiveOurOnlyWorkChats(accountId) {
  const key = accountKey(accountId);
  if (strayArchiveFixInFlight.has(key)) return;
  if (Date.now() - (rearchiveLastRun.get(key) || 0) < REARCHIVE_EVERY_MS) return;
  strayArchiveFixInFlight.add(key);
  rearchiveLastRun.set(key, Date.now());
  try {
    const client = getActiveClient(accountId);
    if (!client) return;
    let listed;
    try {
      listed = await loadArchiveFlags(client);
    } catch (err) {
      console.error(
        `[${accountLabel(accountId)}] Не смог найти мёртвые чаты:`,
        err.errorMessage || err.message,
      );
      return;
    }
    if (!aliveDialogPeers.has(key)) aliveDialogPeers.set(key, new Set());
    const alive = aliveDialogPeers.get(key);

    for (const dialog of listed.dialogs) {
      if (!dialog.isUser || dialog.archived) continue;
      const entity = dialog.entity;
      if (!entity || entity.bot || entity.self) continue;
      if (alive.has(String(entity.id))) continue;

      let incoming = false;
      let sample = '';
      try {
        const recent = await client.getMessages(entity, { limit: 20 });
        const texts = (recent || [])
          .filter((message) => message?.out && !isServiceMessage(message))
          .map((message) => String(message.message || ''))
          .filter(Boolean);
        if (!texts.length && !isDeletedUser(entity)) continue;
        sample = texts.find((text) => OUR_ONLY_WORK_RE.test(text)) || texts[0] || '';
        incoming = await peerHasIncoming(client, entity);
      } catch (err) {
        if (isFloodError(err)) break;
        continue;
      }
      const deleted = isDeletedUser(entity);
      const dead = deleted || !incoming;
      if (!dead) {
        alive.add(String(entity.id));
        continue;
      }

      const name = entity.username || entity.firstName || String(entity.id);
      const why = deleted ? 'удалённый аккаунт' : 'только наши сообщения';
      try {
        await archivePeer(client, entity);
        console.log(
          `[${accountLabel(accountId)}] Мёртвый диалог в архив (${name}, ${why}). Текст: "${sample}"`,
        );
      } catch (err) {
        console.error(
          `[${accountLabel(accountId)}] Не удалось добавить мёртвый диалог ${name} в архив:`,
          err.errorMessage || err.message,
        );
        if (isFloodError(err)) break;
      }
      await sleep(800);
    }
  } finally {
    strayArchiveFixInFlight.delete(key);
  }
}

async function tickNftCampaign(accountId) {
  await rearchiveOurOnlyWorkChats(accountId);
  await tickNftWorkMentions(accountId);
  await tickNftDueVoices(accountId);
}

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
  stripLeakedMediaHistoryTag,
  startLogin,
  resendLoginCode,
  confirmCode,
  confirmPassword,
  cancelPendingLogin,
  cancelAllPendingLoginsForUser,
  activateAccount,
  deactivateAccount,
  getActiveClient,
  isActive,
  accountLabel,
  getAccountUsername,
  findActiveAccountIdByUsername,
  scanUnansweredDialogs,
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
