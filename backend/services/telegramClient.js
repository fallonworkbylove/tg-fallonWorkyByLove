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
  sendMediaItem,
  pickCaption,
  mediaTag,
  clearMediaCache,
} = require('./mediaReplies');
const { isPhotoRecognitionDisabled } = require('./photoRecognitionSettings');
 const helpRequestNotifier = require('./helpRequestNotifier');
const timeStyle = require('./timeStyle');
const moodEngine = require('./moodEngine');
const memoryTriggers = require('./memoryTriggers');
const objectionHandler = require('./objectionHandler');
const complimentEngine = require('./complimentEngine');

// Сколько последних сообщений диалога передавать модели как контекст.
// Было 10 (всего 5 обменов) — бот забывал, о чём уже спрашивал, и мог
// переспросить то же самое буквально через пару сообщений. Увеличили до 30,
// чтобы модель видела заметно больше реальной истории разговора.
const HISTORY_LIMIT = 60;

// Защита от параллельных обработчиков: пока первое голосовое отправляется,
// повторное сообщение из того же диалога не должно запустить вторую отправку.
const voiceSendInFlight = new Set();
const accountLabels = new Map();

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
  } catch {
    accountLabels.set(String(accountId), `ID ${accountId}`);
  }
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
//
// Пример:
//   PROXY_LIST=mtproxy:1.2.3.4:443:ee00aa...;mtproxy:5.6.7.8:443:ee11bb...;socks5:9.9.9.9:1080:user:pass
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
  const parts = raw.split(':').map((s) => s.trim());
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

function readProxyFile() {
  const filePath = process.env.PROXY_FILE
    ? path.resolve(process.env.PROXY_FILE)
    : DEFAULT_PROXY_FILE;

  if (!fs.existsSync(filePath)) return [];

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.warn(`[proxy] Не удалось прочитать файл прокси ${filePath}: ${err.message}`);
    return [];
  }

  const entries = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  console.log(`[proxy] Файл ${filePath}: найдено ${entries.length} записей.`);
  return entries;
}

function buildProxyPool() {
  const pool = [];

  // Новый формат: список в .env
  if (process.env.PROXY_LIST) {
    for (const raw of process.env.PROXY_LIST.split(';')) {
      const entry = raw.trim();
      if (!entry) continue;
      const parsed = parseProxyEntry(entry);
      if (parsed) pool.push(parsed);
    }
  }

  // Файловый способ — записи из PROXY_FILE (или config/proxies.txt по умолчанию).
  for (const entry of readProxyFile()) {
    const parsed = parseProxyEntry(entry);
    if (parsed) pool.push(parsed);
  }

  // Старый формат: одиночный прокси (для обратной совместимости)
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

  return pool;
}

const PROXY_POOL = buildProxyPool();

// Индекс текущего рабочег������������������ прокси. Начинаем с найденного при старте.
let currentProxyIndex = 0;

function proxyLabel(p) {
  return `${p.MTProxy ? 'mtproxy' : 'socks5'} ${p.ip}:${p.port}`;
}

// Список опций подключения для перебора: [без прокси] если пул пуст,
// иначе — по одной записи на каждый прокси (начиная с текущего рабочего).
function connectionCandidates(extra = {}) {
  const base = { connectionRetries: 2, ...extra };
  if (PROXY_POOL.length === 0) return [base];

  // Ставим текущий рабочий прокси первым, затем остальные по кругу.
  // Через прокси подключаемся по порту 443 (порт 80 часто заблокирован).
  const ordered = [];
  for (let i = 0; i < PROXY_POOL.length; i++) {
    const idx = (currentProxyIndex + i) % PROXY_POOL.length;
    ordered.push({
      opts: { ...base, proxy: PROXY_POOL[idx], connection: ConnectionTCPFull443 },
      index: idx,
    });
  }
  return ordered;
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
  console.log(`[proxy] Загружено прокси в пуле: ${PROXY_POOL.length} — ${PROXY_POOL.map(proxyLabel).join(', ')}`);
} else {
  console.log('[proxy] ��рокси не заданы — прямое подключение к Telegram.');
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
  const lastReplyAt = new Map();
  const MIN_REPLY_GAP_MS = 45000;

  // Последний telegram message.id, на который уже ушёл ответ в этом диалоге.
  // Скан/повторный flush с тем же id не должен слать второй ответ.
  const lastAnsweredMsgId = new Map();

  // Пока диалог in-flight, новые тексты не дропаем — копятся и обрабатываются
  // одним ответом после завершения текущего (иначе скан потом шлёт «дубль»).
  const pendingAfterInFlight = new Map();

// Сколько ждать следующего сообщения перед тем, как ответить (мс).
// Человек часто пишет мысль несколькими сообщениями с паузами — даём ему
// договорить, поэтому окно достаточно большое.
const AGGREGATE_WINDOW_MS = 8000;

// Максимальное общее время накопления серии (мс). Даже если собеседн��к
// продолжает печатать без остановки, после этого лимита бот всё равно ответит.
const AGGREGATE_MAX_WAIT_MS = 45000;

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
const DEFER_INTERRUPT_DELAY_MS = 2 * 60 * 1000;

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
  const info = timeStyle.getTimeStyle();
  const awake = isWithinWorkingHours(accountId);
  if (!awake) {
    return { ...info, isSleep: true, isNight: true };
  }
  if (info.isSleep) {
    return {
      ...info,
      id: 'late_evening',
      isSleep: false,
      isNight: true,
      delayMultiplier: Math.max(Number(info.delayMultiplier) || 1, 1.4),
      hint:
        `${String(info.hint || '').replace(/\s*Ты спишь\.[^.]*/i, '')} ` +
        'Уже поздно, скоро спать — отвечай короче и спокойнее, можно сказать что скоро отключишься. ' +
        'Не пиши, что уже спишь.',
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

  const client = new TelegramClient(
    new StringSession(''),
    apiId,
    apiHash,
    clientOptions(),
  );

  await client.connect();

  const { phoneCodeHash } = await client.sendCode({ apiId, apiHash }, phone);

  pendingLogins.set(key, { client, phoneCodeHash });

  return { sent: true };
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

  // Перебираем прокси из пула (или единственный вариант «без прокси»).
  const candidates = connectionCandidates();

  for (const candidate of candidates) {
    // candidate может быть либо {opts, index} (когда есть пул), либо plain opts.
    const opts = candidate.opts || candidate;
    const index = candidate.index;

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

      // Успех. Если использовали прокси — зап������минаем его как текущий рабочий.
      if (index !== undefined && index !== currentProxyIndex) {
        currentProxyIndex = index;
        console.log(`[proxy] Переключился на раб��чи�� прокси: ${proxyLabel(PROXY_POOL[index])}`);
      }

      activeClients.set(accountId, client);

      client.addEventHandler(
        (event) => handleIncomingMessage(accountId, event),
        new NewMessage({ incoming: true }),
      );

      // Фоном «дочитываем» непрочитанны�� диалоги, пришедшие пока аккау��т был
      // offline (minAgeSec=0 — live-обработчик их всё равно не видел).
      scanUnansweredDialogs(accountId, 0).catch((e) =>
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
 * Вычис��яет случайную задержку (в мс) в диапазоне [min, max] секунд.
 * Значения жёстко ограничиваютс�� рамками 1..60 ��екунд, чтобы бот всегда
 * отвечал «по-человече��ки» и не завис на слишком долгой паузе.
 */
function pickReplyDelayMs(settings) {
  const clamp = (n, def) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return def;
    return Math.min(90, Math.max(8, Math.round(v)));
  };

  let min = clamp(settings && settings.reply_delay_min, 8);
  let max = clamp(settings && settings.reply_delay_max, 20);
  // Старые «мгновенные» 1–3с поднимаем; сверхдолгие 25–50с укорачиваем —
  // набор и так даёт 5–10с индикатора.
  if (min <= 3 && max <= 8) {
    min = 8;
    max = 18;
  }
  if (min >= 25 && max >= 40) {
    min = 8;
    max = 20;
  }
  if (min > max) [min, max] = [max, min];

  const seconds = min + Math.random() * (max - min);
  return Math.round(seconds * 1000);
}

/**
 * Пауза перед отправкой текста: настроенное «подумала» плюс набор.
 * Длинное сообщение не должно появляться за несколько секунд.
 */
function delayBeforeSendMs(settings, text) {
  return pickReplyDelayMs(settings) + computeTypingMs(text);
}

/**
 * Оценивает, сколько времени должен «печатать» бот, чтобы длительность
 * индикатора «печатает...» соответствовала длине сообщения — короткое «ок)»
 * не должно печататься 10 секунд, а длинный абзац не должен вылетать мгновенно.
 * Скорость набора текста берётся случайно (14-22 символа/сек — ��бычный темп
 * набора на смартфоне), итог ограничивается разумными рамками 1.2-9 сек.
 */
function computeTypingMs(text) {
  // Индикатор «печатает» 5–10 сек — как набор на телефоне, не мгновенно.
  const MIN_MS = 5000;
  const MAX_MS = 10000;
  const len = (text || '').length;
  const charsPerSec = 4 + Math.random() * 3;
  const ms = (len / charsPerSec) * 1000;
  return Math.min(MAX_MS, Math.max(MIN_MS, Math.round(ms)));
}

/**
 * Выдерживает случайную паузу перед ответом. Индикатор «печатает...»
 * показывается ТОЛЬКО в последние typingMs миллисекунд перед отправкой
 * (по умолчанию 10 сек, но можно передать длительность в зависимости от
 * длины сообщения через computeTypingMs), а до этого бот ждёт молча.
 * Индикатор обновляется каждые ~4 секунды, т.к. Telegram гасит его сам.
 */
async function waitBeforeReply(client, peer, delayMs, typingMs = 10000) {
  const TYPING_LEAD_MS = typingMs; // за сколько до отправки включать «печатает»
  const TYPING_REFRESH = 4000;

  // 1. Тихая фаза: ждём без индикатора (если пауза длиннее 10 сек).
  const silentMs = Math.max(0, delayMs - TYPING_LEAD_MS);
  if (silentMs > 0) {
    await sleep(silentMs);
  }

  // 2. Фаза «печатает»: последние до 10 секунд с индикатором набора.
  let typingElapsed = 0;
  const typingPhaseMs = Math.min(delayMs, TYPING_LEAD_MS);

  while (typingElapsed < typingPhaseMs) {
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

    const chunk = Math.min(TYPING_REFRESH, typingMs - typingElapsed);
    await sleep(chunk);
    typingElapsed += chunk;
  }
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
 * При любой ошибке возвращает true — в спорных случаях лучше не писать,
 * чем случайно написать человеку из архива.
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
    if (!dialog) return true;
    if (dialog.className === 'DialogFolder') return true;

    // folderId === 1 / archived === true -> архив. undefined/0 -> основной список.
    if (dialog.archived === true) return true;
    return Number(dialog.folderId) === 1;
  } catch (err) {
    console.error(
      'Не удалось определить папку диалога — ответ заблокирован для безопасности:',
      err.errorMessage || err.message,
    );
    return true;
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
const WORK_PROBLEM_PHRASES = [
  'минутку, по работе отвлекусь)',
  'щас чуть по работе)',
  'ой, работу гляну быстро)',
  'секунду, рабочее)',
];

let nftScheduleReady = false;
const nftWorkMentionInFlight = new Set();
const nftVoiceTickInFlight = new Set();

function pickWorkProblemPhrase() {
  return WORK_PROBLEM_PHRASES[Math.floor(Math.random() * WORK_PROBLEM_PHRASES.length)];
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
  const line = pickWorkProblemPhrase();
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

function shouldSuppressNftForTurn(text, { flipPhotoQuestion = false, explicitMediaRequest = false } = {}) {
  if (flipPhotoQuestion || explicitMediaRequest) return true;
  if (objectionHandler.isAskingHerName(text)) return true;
  if (objectionHandler.isDirectQuestion(text)) return true;
  if (objectionHandler.isAboutHerJobQuestion(text)) return true;
  if (objectionHandler.isContactOrMeetRelated(text)) return true;
  return false;
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
  }
}

async function loadArchiveFlags(client) {
  const flags = new Map();
  const { dialogs, complete } = await listUserDialogs(client);
  rememberArchiveFlags(dialogs, flags);
  flags.complete = complete;
  return flags;
}

function isHiddenFromReplies(flags, peerId) {
  return flags.get(String(peerId)) !== false;
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
      'намекнуть что иногда крутишь мелкие сделки. Полфразы, НЕ главная тема. Сначала ответь на его слова. ' +
      'Если намёк натянут — пропусти. Без уговоров, ссылок, сумм.',
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
 */
function isContradictoryMediaText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (REFUSAL_RE.test(t)) return true;
  // Короткий отказ в начале: «не, …», «неа, …», «нет, …»
  if (/^(не|неа|нет|no|nope)\b/i.test(t)) return true;
  return false;
}

// Явная просьба прислать медиа. Нужна, чтобы:
//  1) такая просьба имела приоритет над голосовыми заготовками (вариант Б);
//  2) отличать реальный запрос от простого вопроса про уже присланное медиа.
// Требуем И глагол-просьбу («скинь/пришли/покажи/запиши/можешь»), И объект
// («фото/видео/кружок/себя»), чтобы «куда едешь на кружочке?» НЕ считалось просьбой.
const MEDIA_REQUEST_VERB_RE =
  /(скинь|скинешь|кинь|кинешь|пришли|пришлёшь|пришлешь|отправь|отправишь|отправляй|покажи|покажешь|запиши|запишешь|сфоткай|сфоткайся|сделай|можешь|можно|давай|хочу увидеть|хочу посмотреть|дай посмотреть|есть\s+фото|фото\s+есть)/i;
const MEDIA_REQUEST_OBJ_RE =
  /(фото|фотк|фоточк|фоточ|селфи|видео|видосик|видос|кружок|кружочек|кружочк|себя|как ты выглядишь|как выглядишь|своё лицо|свое лицо|личико)/i;
const MEDIA_REQUEST_SHORT_RE =
  /(^|\n)\s*(а\s+)?(фото|фотку|фоточку|селфи|видео|видос|кружок|кружочек)\s*\??\s*($|\n)/i;

function isExplicitMediaRequest(text) {
  if (!text) return false;
  const t = String(text);
  if (MEDIA_REQUEST_VERB_RE.test(t) && MEDIA_REQUEST_OBJ_RE.test(t)) return true;
  if (MEDIA_REQUEST_SHORT_RE.test(t)) return true;
  if (/(есть|скинь|покажи|пришли|кинь).{0,48}(фото|фотк|видео|круж|себя|селфи)/i.test(t)) return true;
  return false;
}

function detectRequestedMediaType(text) {
  const t = String(text || '');
  if (/кружок|кружочек|video\s*note/i.test(t)) return 'circle';
  if (/видео|видос/i.test(t)) return 'video';
  return 'photo';
}

const MEDIA_FAIL_DEFLECTS = [
  'ой что-то с фотками затык, давай лучше расскажи как день)',
  'неа, давай про тебя) чем сейчас занят?',
  'потом как-нибудь, а сейчас лучше напиши что интересного было)',
  'давай без фоток, расскажи лучше что у тебя нового)',
];

function pickMediaFailDeflect() {
  return MEDIA_FAIL_DEFLECTS[Math.floor(Math.random() * MEDIA_FAIL_DEFLECTS.length)];
}

// Было ли ПОСЛЕДНЕЕ сообщение бота отправкой медиа (метка [медиа:#id]).
// Используем, чтобы не слать второе медиа в ответ на уточняющий вопрос
// про предыдущее («а куда едешь на кружочке?»).
function lastAssistantWasMedia(history) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') {
      return /\[медиа:#\d+\]/.test(String(history[i].content || ''));
    }
  }
  return false;
}

function extractMediaRequest(reply) {
  const first = reply.match(/<<\s*(PHOTO|VIDEO|CIRCLE)\s*>>/i);
  const map = { PHOTO: 'photo', VIDEO: 'video', CIRCLE: 'circle' };
  const mediaType = first ? map[first[1].toUpperCase()] : null;
  let text = reply
    .replace(MEDIA_TOKEN_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  // Подстраховка: если модель всё же прислала отказ ВМЕСТЕ с медиа-токеном
  // (например «не, давай пока тут общаться)» + <<CIRCLE>>), убираем
  // противоречивый текст — раз медиа реально уходит, отказ выглядит как фейк.
  // Оставляем пусто: файл уйдёт со своей случайной дружелюбной подписью.
  if (mediaType && isContradictoryMediaText(text)) {
    text = '';
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
) {
  try {
    const sentIds = await getSentMediaSet(accountId, peerId);
    let record = await getMediaItems(client, accountId, link);
    let item = pickUnsentMedia(record.items, mediaType, sentIds);
    if (!item) {
      console.log(
        `[${accountLabel(accountId)}] В медиа-чате нет медиа типа "${mediaType}" для ${senderName}.`,
      );
      return false;
    }

    try {
      const caption = mediaType === 'circle' ? '' : pickCaption(mediaType);
      await sendMediaItem(client, sender, item, caption);
    } catch (e) {
      // Устаревшая ссылка на файл — сбрасываем кэш и пробуем ещё раз.
      if (String(e.message || '').includes('FILE_REFERENCE')) {
        clearMediaCache(accountId, link);
        record = await getMediaItems(client, accountId, link);
        item = pickUnsentMedia(record.items, mediaType, sentIds) || item;
        const caption = mediaType === 'circle' ? '' : pickCaption(mediaType);
        await sendMediaItem(client, sender, item, caption);
      } else {
        throw e;
      }
    }

    await saveMessage(accountId, peerId, senderName, 'assistant', mediaTag(item.id));
    console.log(
      `[${accountLabel(accountId)}] Отправлено медиа (${mediaType}) #${item.id} для ${senderName}.`,
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
  );
  if (sent) return true;

  const deflect = pickMediaFailDeflect();
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
// «СКОЛЬКО СИДИШЬ» + АВТОАР��ИВ ПРИ СРОКЕ БОЛЬШЕ 2 НЕДЕЛЬ
// ---------------------------------------------------------------------------

// Синхронный замок «вопрос уже отправляется» для пары аккаунт+собеседник.
// Защита от гонки: пока идёт пауза перед вопросом, второе входящее
// сообщение не должно отправить тот же вопрос повторно.
const howLongInFlight = new Set();

// Названия платформы — в вопросе используется О��НО случайное, а не все сразу.
const HOWLONG_PLATFORMS = ['дс', 'сз', 'дайвинчике'];

// Собирает текст вопроса «сколько сидишь» с одним случайным названием.
function buildHowLongQuestion() {
  const place =
    HOWLONG_PLATFORMS[Math.floor(Math.random() * HOWLONG_PLATFORMS.length)];
  return `слушай, а ты давно тут си��ишь, на ${place}? сколько уже примерно?`;
}

// После скольких сообщений собеседника задавать вопрос.
const HOWLONG_AFTER_MESSAGES = 3;

/**
 * Проверяет по истории, задавали ли мы уже ��опрос «ск��л��ко сидишь»
 * (любой из вариантов ��� ищем по ��ст��й��ивой части фразы).
 */
async function wasHowLongAsked(accountId, peerId) {
  const [rows] = await db.execute(
    `SELECT id FROM conversation_messages
     WHERE account_id = ? AND peer_id = ? AND role = 'assistant'
       AND content LIKE '%давно тут сидишь%'
     LIMIT 1`,
    [accountId, peerId],
  );
  return rows.length > 0;
}

/**
 * Считает, сколько сообщений написал собеседник (role = 'user').
 */
async function countUserMessages(accountId, peerId) {
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS cnt FROM conversation_messages
     WHERE account_id = ? AND peer_id = ? AND role = 'user'`,
    [accountId, peerId],
  );
  return rows[0] ? Number(rows[0].cnt) : 0;
}

/**
 * Проверяет, есть ли в истории сообщение с точно таким содержимым
 * (например, уже заданный вопрос «сколько сидишь»).
 */
async function historyHasContent(accountId, peerId, content) {
  const [rows] = await db.execute(
    `SELECT id FROM conversation_messages
     WHERE account_id = ? AND peer_id = ? AND content = ?
     LIMIT 1`,
    [accountId, peerId, content],
  );
  return rows.length > 0;
}

/**
 * Разбирает ответ собеседника про срок и определяет, БОЛЬШЕ ли это 2 недель
 * (строго > 14 дней). Возвращает true, есл�� срок явно больше двух недель.
 *
 * Понимает годы, месяцы, полгода, недели и дни, числа цифрами и словами.
 */
function parseDurationOverTwoWeeks(text) {
  const t = (text || '').toLowerCase();

  // Числа словами -> цифры.
  const wordNums = {
    полтора: 1.5,
    полторы: 1.5,
    один: 1,
    одна: 1,
    два: 2,
    две: 2,
    пару: 2,
    парочку: 2,
    три: 3,
    четыре: 4,
    пять: 5,
    шесть: 6,
    семь: 7,
    восемь: 8,
    девять: 9,
    десять: 10,
    несколько: 3,
    много: 12,
  };

  const numMatch = t.match(/(\d+([.,]\d+)?)/);
  let num = numMatch ? parseFloat(numMatch[1].replace(',', '.')) : null;
  if (num === null) {
    for (const [w, n] of Object.entries(wordNums)) {
      if (t.includes(w)) {
        num = n;
        break;
      }
    }
  }

  const explicitMore = /(больше|более|свыше|дольше|давно)/.test(t);

  // Годы и полгода — заведомо больше 2 недель.
  if (/(год|года|годи|лет)/.test(t)) return true;
  if (/(полгода|пол года)/.test(t)) return true;

  // Месяцы — тоже больше 2 недель.
  if (/(месяц|месяца|месяцев|мес\b)/.test(t)) return true;

  // ��едели: > 2 недель, либо «больше 2 недель».
  if (/недел/.test(t)) {
    if (num !== null) {
      if (num > 2) return true;
      if (num === 2 && explicitMore) return true;
      return false;
    }
    return false;
  }

  // Дни: больше 14 дней.
  if (/(день|дня|дней|дн\b|сутк)/.test(t)) {
    if (num !== null && num > 14) return true;
    return false;
  }

  return false;
}

/**
 * Перемещает диалог с собеседником в АРХИВ (folder_id = 1).
 */
async function archivePeer(client, inputPeer) {
  const peer = await client.getInputEntity(inputPeer);
  await client.invoke(
    new Api.folders.EditPeerFolders({
      folderPeers: [
        new Api.InputFolderPeer({ peer, folderId: 1 }),
      ],
    }),
  );
  return true;
}

/**
 * Проверяет, ��ора ли «невзначай» задать вопрос «сколько сидишь»:
 *   - его ещё не задавали это��у собеседнику;
 *   - собеседник написал уже достаточно сообщений (HOWLONG_AFTER_MESSAGES).
 * Возвращает true, если вопрос нужно задать в этот ход (вместо AI-ответа).
 */
async function shouldAskHowLong(accountId, peerId) {
  if (await wasHowLongAsked(accountId, peerId)) return false;

  const count = await countUserMessages(accountId, peerId);
  return count >= HOWLONG_AFTER_MESSAGES;
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
  // 1. Обычный текст (или подпись отсутствует у медиа).
  const rawText = message.message || '';

  // 2. Голо��овое или ауди�� — скачиваем и расшифровываем через Whisper.
  if (message.voice || message.audio) {
    const client = getActiveClient(accountId);
    if (!client) return attach(rawText);

    try {
      const buffer = await client.downloadMedia(message, {});
      if (buffer && buffer.length) {
        const transcript = await transcribeAudio(buffer);
        if (transcript) {
          return attach(rawText ? `${rawText}\n[Голосовое]: ${transcript}` : `[Голосовое]: ${transcript}`);
        }
      }
    } catch (e) {
      console.error(`[${accountLabel(accountId)}] Не удалось расшифровать го��осовое:`, e.message);
    }

    return attach(rawText);
  }

  // 3. Фото — распознаём соде��жимое, кр��ме чатов из списка исключений
  // (распознавание для них отключено во всех сессиях пользователя) и кроме
  // соб��седников, спр��танн��х в АРХИВ (folder_id = 1) — им фото не разбираем.
  if (message.photo) {
    if (peerId && (await isPhotoRecognitionDisabled(accountId, peerId, peerUsername))) {
      console.log(
        `[${accountLabel(accountId)}] Распознавание фото отключено для этого чата — пропускаю.`,
      );
      return attach(rawText);
    }

    const client = getActiveClient(accountId);
    if (!client) return attach(rawText);

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
        const description = await describeImage(buffer, rawText);
        if (isViewOnceOrExpiringMedia(message)) {
          await markMessageContentsOpened(client, message);
        }
        if (description) {
          console.log(
            `[${accountLabel(accountId)}] Фото распознано: "${description}"`,
          );
          const caption = rawText ? ` Подпись: "${rawText}".` : '';
          const once = isViewOnceOrExpiringMedia(message) ? 'одноразовое ' : '';
          return attach(`[${once}фото от собеседника]: ${description}.${caption}`);
        }
      }
    } catch (e) {
      console.error('Не удалось скачать/распознать фото:', e.message);
    }
    return attach(rawText);
  }

  // 4. Видео / кружок / одноразовое видео — скачиваем, смотрим кадры, помечаем просмотренным.
  if (isVideoMessage(message)) {
    return attach(await extractIncomingVideoText(accountId, message, rawText));
  }

  // 5. Стикер — раньше отбрасывался (пустой message.message), из‑за этого
  // «ЗДРАСТИ»/привет-стикеры оставались без ответа.
  if (isStickerMessage(message)) {
    return attach(await extractStickerText(accountId, message, rawText));
  }

  // 6. Прочее — возвращаем текст вместе с цитатой, если человек ответил на неё.
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
        const d = await describeImage(frame, rawText || `кадр из ${label}`);
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
async function extractStickerText(accountId, message, rawText) {
  const emoji = getStickerEmoji(message);
  let description = '';

  const client = getActiveClient(accountId);
  if (client) {
    try {
      const buffer = await client.downloadMedia(message, {});
      if (buffer && buffer.length) {
        description = (await describeImage(buffer, emoji || 'стикер')) || '';
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
      return;
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

  // Склеиваем все сообщения серии в один текст (каждое с новой стро��и).
  const combinedText = entry.texts.join('\n').trim();

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

  let workMentionClaimed = false;
  try {
    const mediaLink =
      typeof settings.media_chat_link === 'string'
        ? settings.media_chat_link.trim()
        : '';
    const explicitMediaRequest = isExplicitMediaRequest(text);
    // Отложенный ответ тоже должен отдавать медиа, если человек просил —
    // раньше тут было mediaEnabled=false и фото «пропадало», а другим уходило.
    const mediaEnabled = !!mediaLink && explicitMediaRequest;
    const noMediaExcuse = explicitMediaRequest && !mediaLink;
    const nft = await getNftCampaignState(accountId, peerId, history.length);
    const suppressNft = shouldSuppressNftForTurn(text, {
      flipPhotoQuestion: false,
      explicitMediaRequest: isExplicitMediaRequest(text),
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
    const dueMemory = await memoryTriggers.getDueFollowUp(accountId, peerId);
    const liveHistory = await getHistory(accountId, peerId);
    const replyHistory = liveHistory.length ? liveHistory : history;
    const flipPhotoQuestion = await objectionHandler.shouldForceReplyForFlipPhoto(
      text,
      replyHistory,
      accountId,
      peerId,
    );
    let objectionHint = objectionHandler.detectHint(text, replyHistory);
    if (flipPhotoQuestion) {
      objectionHint = objectionHandler.getFlipPhotoQuestionHint();
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
    const [learningSnippet, manualSnippet, ragSnippet] = await Promise.all([
      learningDb.buildLearningSnippet(learningStage),
      learningDb.buildManualTrainingSnippet(accountId, text),
      ragExamples.buildRagSnippet(ragDay, text),
    ]);
    // Факт из входящего сообщения запоминаем «на будущее» (не блокирует ответ).
    memoryTriggers.extractAndSaveFact(accountId, peerId, text).catch(() => {});

    const emotionHint = buildEmotionHint(replyHistory);
    const sessionForgetHint = buildSessionForgetHint(replyHistory.length <= 4);

    const rawReply = await generateReply(settings.prompt, replyHistory, text, {
      mediaEnabled,
      noMediaExcuse,
      campaignHint: suppressNft || flipPhotoQuestion ? null : nft.hint,
      learningSnippet,
      manualSnippet,
      ragSnippet,
      timeHint: timeInfo.hint,
      moodHint: moodInfo.hint,
      emotionHint,
      sessionForgetHint,
      memoryHint: sessionForgetHint ? null : useMemoryHint,
      objectionHint,
      complimentHint,
    });
    if (!rawReply) return;
    if (dueMemory && useMemoryHint && !sessionForgetHint) memoryTriggers.markFollowedUp(dueMemory.id).catch(() => {});

    const { text: replyWithoutLaugh, laugh } = splitLaugh(rawReply);
    const { text: replyWithoutReact, reaction } = extractReaction(replyWithoutLaugh);
    const { text: reply, mediaType: rawMediaType } =
      extractMediaRequest(replyWithoutReact);

    let mediaType = rawMediaType;
    if (explicitMediaRequest && mediaLink && !mediaType) {
      mediaType = detectRequestedMediaType(text);
    }
    if (mediaType && !explicitMediaRequest && lastAssistantWasMedia(history)) {
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
      outText = '';
    }

    // «по работе» — только после ответа, отдельным сообщением (maybeSendWorkAside).
    const pendingWorkAside = !!nft.sayWorkProblem;

    const reactionOnly = !!reaction && !outText && !mediaType && !nft.sendVoice;

    // Небольшая «естественная» пауза перед отправкой — как будто отвлеклась
    // на пару минут, но всё-таки вернулась ответить на вопрос. Длительность
    // индикатора «печатает...» зависит от длины итогового текста.
    const delayMs = delayBeforeSendMs(settings, outText);
    if (reactionOnly) {
      await sleep(800 + Math.floor(Math.random() * 2200));
    } else {
      console.log(
        `[${accountLabel(accountId)}] Пауза ${Math.round(delayMs / 1000)}с перед отложенным ответом для ${senderName}.`,
      );
      await waitBeforeReply(client, sender, delayMs, computeTypingMs(outText));
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

    if (outText) {
      await markPeerAsRead(client, sender, null);
      await sendHumanText(client, sender, accountId, peerId, senderName, outText);
      lastReplyAt.set(bufferKey(accountId, peerId), Date.now());
      await learningDb.recordBotReply(accountId, peerId, text, outText, learningStage);
      console.log(
        `[${accountLabel(accountId)}] Отложенный ответ для ${senderName}: "${outText}"`,
      );
    }

    if (laugh && !nft.sendVoice && !reactionOnly && !laughedRecently(history)) {
      await sendLaughBubble(client, sender, accountId, peerId, senderName);
    }

    let mediaSentThisTurn = false;
    if (mediaType && mediaEnabled) {
      mediaSentThisTurn = await sendRequestedMediaOrDeflect(
        client,
        sender,
        accountId,
        peerId,
        senderName,
        mediaType,
        mediaLink,
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
        console.log(
          `[${accountLabel(accountId)}] Отправлено голосовое про NFT (3-й день) для ${senderName}.`,
        );
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

/** ~12% шанс: отправить с опечаткой, затем поправку отдельным сообщением. */
function maybeTypoPair(text) {
  const src = String(text || '').trim();
  if (!src || src.length < 6 || src.length > 90) return null;
  if (/<<|\[реакция:|\[голос|\[фото|\[медиа/i.test(src)) return null;
  if (Math.random() > 0.12) return null;

  const words = src.split(/(\s+)/);
  const candidates = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!/^[а-яёa-z]{4,}$/i.test(w)) continue;
    candidates.push(i);
  }
  if (!candidates.length) return null;
  const idx = candidates[Math.floor(Math.random() * candidates.length)];
  const word = words[idx];
  const letters = word.split('');
  const mode = Math.random();
  if (mode < 0.4 && letters.length >= 4) {
    const j = 1 + Math.floor(Math.random() * (letters.length - 2));
    [letters[j], letters[j + 1]] = [letters[j + 1], letters[j]];
  } else if (mode < 0.7) {
    const j = 1 + Math.floor(Math.random() * (letters.length - 1));
    letters.splice(j, 1);
  } else {
    const j = 1 + Math.floor(Math.random() * (letters.length - 1));
    const pool = /[а-яё]/i.test(word) ? 'аеиоуклмнпрст' : 'aeiouklmnprst';
    letters.splice(j, 0, pool[Math.floor(Math.random() * pool.length)]);
  }
  const broken = letters.join('');
  if (broken.toLowerCase() === word.toLowerCase()) return null;
  words[idx] = broken;
  const wrong = words.join('');
  const fixVariants = [
    `*${word}`,
    `ой, ${word}`,
    `${word}*`,
  ];
  const fix = fixVariants[Math.floor(Math.random() * fixVariants.length)];
  return { wrong, fix, original: src };
}

async function sendHumanText(client, sender, accountId, peerId, senderName, outText) {
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

  if (msgId && lastAnsweredMsgId.get(inFlightKey) === msgId) {
    console.log(
      `[${accountLabel(accountId)}] ${senderName}: сообщение #${msgId} уже отвечено — дубль пропускаю.`,
    );
    return;
  }

  processingInFlight.add(inFlightKey);

  const lastReply = lastReplyAt.get(inFlightKey) || 0;
  if (Date.now() - lastReply < MIN_REPLY_GAP_MS) {
    console.log(
      `[${accountLabel(accountId)}] Слишком скоро после предыдущего ответа — пропускаю повторный ответ для ${senderName}.`,
    );
    processingInFlight.delete(inFlightKey);
    // Если пришли новые тексты во время gap — всё равно не читаем и не отвечаем сейчас;
    // скан подхватит непрочитанное позже, когда gap истечёт.
    return;
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
      if (pendingWorkAside) {
        await maybeSendWorkAside(client, sender, accountId, peerId, senderName, true);
      }
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
        contextualText = `${text}\n[Ответ на сообщение собеседника: "${repliedText}"]`;
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
        `[${accountLabel(accountId)}] ${senderName} написал во время паузы — отменяю свой вопрос, отвечу на последнее сообщение через ~2 мин.`,
      );
    }

    // Явная просьба прислать медиа определяется заранее — она нужна и для
    // приоритета над голосовыми, и для медиа-логики ниже.
    const explicitMediaRequest = isExplicitMediaRequest(contextualText);
    const mediaLinkEarly =
      typeof settings.media_chat_link === 'string'
        ? settings.media_chat_link.trim()
        : '';

    // 3. Проверяем голосовые заготовки по ВХОДЯЩЕМУ сообщению.
    // voice.voiceOnly === true  -> отправляем ТОЛЬКО голосовое, без AI-текста.
    // voice.voiceOnly === false -> AI ответит текстом, а голосовое уйдёт следом.
    // Каждую заготовку шлём собеседнику лишь один раз: если она уже
    // отправлялась (метка есть в истории) — второй раз не дублируем.
    //
    // ВАРИАНТ Б: если человек Я��НО просит фото/видео/кружок, а у аккаунта
    // задан медиа-чат — голосовые заготовки НЕ перехватывают запрос. Иначе
    // «запиши кру��ок, что делаешь» лови��ось бы триггером «что делаешь» и
    // уходило гол��совое вместо кружка.
    let voice =
      explicitMediaRequest && mediaLinkEarly ? null : findVoiceForText(text);

    // Голосовые файлы на русском — англоязычным / не-RU собеседникам не шлём.
    const allowVoice = isRussianConversation(contextualText || text, history);
    if (voice && !allowVoice) {
      console.log(
        `[${accountLabel(accountId)}] ${senderName} пишет не по-русски — голосовые заготовки пропускаю.`,
      );
      voice = null;
    }

    voiceDialogKey = voice ? `${accountId}:${String(peerId)}` : null;
    if (
      voice &&
      (voiceSendInFlight.has(voiceDialogKey) || (await wasAnyVoiceSent(accountId, peerId)))
    ) {
      console.log(
        `[${accountLabel(accountId)}] Голосовое уже отправлялось или отправляется ${senderName} — повторно не отправляю.`,
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
      await waitBeforeReply(client, sender, delayMs);
      await markPeerAsRead(client, sender, message);
      await sendVoiceReply(client, sender, voice.filePath);
      if (msgId) lastAnsweredMsgId.set(inFlightKey, msgId);
      lastReplyAt.set(inFlightKey, Date.now());
      await saveMessage(
        accountId,
        peerId,
        senderName,
        'assistant',
        voiceTag(voice.fileName),
      );
      releaseVoiceSlot();
      console.log(
        `[${accountLabel(accountId)}] Отправлено только голосовое (без текста) для ${senderName}.`,
      );
      return;
    }

    // 3.5. Фиксированные текстовые ответы по триггеру (без обращения к AI).
    // Например, на «что ищешь здесь?» отвечаем заранее заданным текстом.
    const fixedReply = findTextReplyForText(text);
    if (fixedReply) {
      releaseVoiceSlot();
      const textDelayMs = forcedDelayMs != null ? forcedDelayMs : delayBeforeSendMs(settings, fixedReply);
      console.log(
        `[${accountLabel(accountId)}] Пауза ${Math.round(textDelayMs / 1000)}с перед фиксированным ответом для ${senderName}.`,
      );
      await waitBeforeReply(client, sender, textDelayMs, computeTypingMs(fixedReply));
      await markPeerAsRead(client, sender, message);
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

    // Медиа-протокол включаем ТОЛЬКО когда собеседник ЯВНО попросил фото/видео/
    // кружок — ИИ больше не решает сама «по желанию» прислать медиа. Так модель
    // никогда не вставит токен <<PHOTO>>/<<VIDEO>>/<<CIRCLE>> без прямой просьбы.
    const mediaLink = mediaLinkEarly;
    const mediaEnabled = !!mediaLink && explicitMediaRequest;
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
    const dueMemory = await memoryTriggers.getDueFollowUp(accountId, peerId);
    let objectionHint = objectionHandler.detectHint(text, history);
    if (flipPhotoQuestion) {
      objectionHint = objectionHandler.getFlipPhotoQuestionHint();
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
    const [learningSnippet, manualSnippet, ragSnippet] = await Promise.all([
      learningDb.buildLearningSnippet(learningStage),
      learningDb.buildManualTrainingSnippet(accountId, text),
      ragExamples.buildRagSnippet(ragDay, contextualText || text),
    ]);
    // Факт из входящего сообщения запоминаем «на будущее» (не блокирует ответ).
    memoryTriggers.extractAndSaveFact(accountId, peerId, text).catch(() => {});

    const emotionHint = buildEmotionHint(history);
    const sessionForgetHint = buildSessionForgetHint(history.length <= 4);

    const rawReply = await generateReply(settings.prompt, history, text, {
      mediaEnabled,
      noMediaExcuse,
      campaignHint: suppressNft || flipPhotoQuestion ? null : nft.hint,
      learningSnippet,
      manualSnippet,
      ragSnippet,
      timeHint: timeInfo.hint,
      moodHint: moodInfo.hint,
      emotionHint,
      sessionForgetHint,
      memoryHint: sessionForgetHint ? null : useMemoryHint,
      objectionHint,
      complimentHint,
    });
    if (!rawReply) return;
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
    if (mediaType && !explicitMediaRequest && lastAssistantWasMedia(history)) {
      console.log(
        `[${accountLabel(accountId)}] Подавил повторное медиа (${mediaType}) для ${senderName}: прошлый ответ уже был медиа, явной просьбы нет.`,
      );
      mediaType = null;
    }

    // 6. Готовим текстовый ответ (если он есть — модель могла прислать
    // только токен без текста). Крайний случай: медиа подавили (см. выше), а
    // текста моде��ь не дала — тогд�� шлём короткую нейтральную фразу, чтобы
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
      outText = '';
    }

    // «по работе» — только после ответа, отдельным сообщением (maybeSendWorkAside).
    const pendingWorkAside = !!nft.sayWorkProblem;

    const reactionOnly = !!reaction && !outText && !mediaType && !voice && !nft.sendVoice;

    // 5. Держим случайную паузу с индикатором «печатает...» — так ответ
    // выглядит ��ивым, а не мгновенным. Длительность индикатора зависит от
    // длины итогового текста, чтобы длинные сообщения «печатались» дольше.
    if (reactionOnly) {
      const reactDelay = 800 + Math.floor(Math.random() * 2200);
      console.log(
        `[${accountLabel(accountId)}] Пауза ${Math.round(reactDelay / 1000)}с перед реакцией для ${senderName}.`,
      );
      await sleep(reactDelay);
    } else {
      const textDelayMs = forcedDelayMs != null ? forcedDelayMs : delayBeforeSendMs(settings, outText);
      console.log(
        `[${accountLabel(accountId)}] Пауза ${Math.round(textDelayMs / 1000)}с перед ответом для ${senderName}.`,
      );
      await waitBeforeReply(client, sender, textDelayMs, computeTypingMs(outText));
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

    if (outText) {
      await markPeerAsRead(client, sender, message);
      await sendHumanText(client, sender, accountId, peerId, senderName, outText);
      lastReplyAt.set(bufferKey(accountId, peerId), Date.now());
      if (msgId) lastAnsweredMsgId.set(inFlightKey, msgId);
      await learningDb.recordBotReply(accountId, peerId, text, outText, learningStage);
      console.log(`[${accountLabel(accountId)}] Ответ для ${senderName}: "${outText}"`);
      if (pendingWorkAside) {
        await maybeSendWorkAside(client, sender, accountId, peerId, senderName, true);
      }
    }

    if (laugh && !voice && !nft.sendVoice && !reactionOnly && !laughedRecently(history)) {
      await sendLaughBubble(client, sender, accountId, peerId, senderName);
    }

    // 6.5. Медиа по запросу: всем, кто явно просил и у кого есть медиа-чат.
    let mediaSentThisTurn = false;
    if (mediaType && mediaEnabled) {
      mediaSentThisTurn = await sendRequestedMediaOrDeflect(
        client,
        sender,
        accountId,
        peerId,
        senderName,
        mediaType,
        mediaLink,
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
    }

    // 8. Третий день знакомства — голосовое с просьбой помочь с NFT-токеном.
    // Отправляем ОДИН раз за весь диалог (метка в истории) и не в тот же ход,
    // когда уже ушло друг��е голосовое или медиа — иначе выглядит ��ак спам.
    if (nft.sendVoice && !voice && !mediaSentThisTurn) {
      const nftPath = path.join(VOICES_DIR, NFT_VOICE_FILE);

      if (!fs.existsSync(nftPath)) {
        console.error(
          `[А��каунт ${accountId}] Файл ${NFT_VOICE_FILE} не найден в voices/ — голосовое про NFT не отправлено.`,
        );
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
          // Дальше с этим собеседником ведёт оператор вручную — ИИ замолкает
          // именно в этом диалоге, остальные диалоги аккаунта не затрагиваются.
          await helpRequestNotifier.disableAutoreplyForPeer(accountId, peerId, 'nft_voice_sent');
          console.log(
            `[${accountLabel(accountId)}] Отправлено голосовое про NFT (3-й день) для ${senderName}.`,
          );
        } finally {
          voiceSendInFlight.delete(sendKey);
        }
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
 * Сканирует НЕархивные личные диалоги и отвечает на непрочитанные.
 *
 * @param {number} accountId
 * @param {number} minAgeSec Минимальный «возраст» последнего сообщения в
 *   секундах. Для периодического скана ставим ~90с, чт��бы не конфликтовать с
 *   live-обработчиком (он копит и отвечает в пределах ~45с + задержка). Для
 *   скана при активации передаём 0: сообщения, пришедшие до подключения,
 *   live-обраб����тчик всё равно не видел.
 */
async function scanUnansweredDialogs(accountId, minAgeSec = 90) {
  if (scanInFlight.has(accountId)) return;
  scanInFlight.add(accountId);
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
      dialogs = await client.getDialogs({ limit: SCAN_DIALOGS_LIMIT });
    } catch (e) {
      console.error(
        `[${accountLabel(accountId)}] Скан: не удалось получить диалоги:`,
        e.errorMessage || e.message,
      );
      return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    let replied = 0;

    for (const dialog of dialogs) {
      if (replied >= SCAN_MAX_REPLIES) break;

      // Только ли��ные чаты (не группы/каналы).
      if (!dialog.isUser) continue;
      // Архив пропускаем полностью — отвечаем только тем, кто НЕ в архиве.
      if (dialog.archived) continue;

      const message = dialog.message;
      if (!message) continue;
      // Последнее сообщ��ние НАШЕ -> мы уже ответили -> пропуска��м.
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

      // Если это сообщение сей��ас ��опит live-обработчик — не вмешиваемся.
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
// непрочитанные вопросы ночью не ��рогаем.
// Утром пишем «доброе утро» ВСЕМ недавним, и если человек написал ночью и
// ждёт ответа — СЛЕДОМ (вторым сообщением) отвечаем ему по теме.
// ---------------------------------------------------------------------------

// Вариа��ты фраз (случайный выбор — чтобы не выглядело шаблонно).
const NIGHT_GREETINGS = [
  'спокойной ночи, сладких снов)',
  'ладно, спать пора, целую, споки',
  'всё, отрубаюсь, сладких снов, береги себя',
  'пойду спать, споки-споки, ты мне снись',
  'доброй ночи, до завтра, буду скучать',
];
const MORNING_GREETINGS = [
  'доброе утро, как спалось)',
  'утро доброе, соскучилась',
  'привееет, с добрым утром',
  'доброе, проснулась и сразу про тебя',
  'утречко доброе, береги себя)',
];

const NIGHT_GREETINGS_EN = [
  'good night, sweet dreams)',
  'alright, time to sleep, night night',
  'gonna pass out, sweet dreams, take care',
  'going to bed, night night, dream of me',
  'good night, see you tomorrow, gonna miss you',
];
const MORNING_GREETINGS_EN = [
  'good morning, how did you sleep)',
  'morning, missed you',
  'heyyy, good morning',
  'morning, woke up and thought of you',
  'good morning, take care)',
];

const MORNING_BY_KIND = {
  robot: MORNING_GREETINGS,
  early: [
    'чё так рано вскочила, доброе утро)',
    'рано проснулась, привет',
    'не спалось, уже встала',
    'глаза сами открылись, доброе',
  ],
  normal: [
    'доброе утро, как спалось)',
    'утро доброе, соскучилась',
    'привееет, с добрым утром',
    'доброе, проснулась и сразу про тебя',
  ],
  oversleep: [
    'проспала жесть, только встала',
    'заспалась, доброе',
    'сори, проспала',
    'только глаза открыла, заспалась',
  ],
  lunch: [
    'я только к обеду глаза открыла ахах',
    'проспала до обеда, привет',
    'в обед встала, доброе)',
    'доброе, я к обеду только выползла',
  ],
  late: [
    'только встала, заспалась нормально',
    'доброе, почти до обеда дрыхла',
    'проспала почти до обеда, привет',
  ],
};

const NIGHT_BY_KIND = {
  robot: NIGHT_GREETINGS,
  early: [
    'что-то меня рубит, пойду спать',
    'глаза закрываются, споки',
    'сегодня рано отрубаюсь, спокойной',
  ],
  half_past: [
    'не хотела спать, но уже полпервого, споки',
    'ещё бы посидела, но глаза слипаются',
    'ладно всё, засиделась, спокойной ночи)',
  ],
  late: [
    'что-то не спалось, но всё отрубаюсь',
    'засиделась, уже поздно, споки',
    'глаза сами закрываются, спокойной',
  ],
  three_am: [
    'уже часа три, всё я спать',
    'досиделась до трёх, спокойной',
    'не хотела ложиться и вот, отрубаюсь',
  ],
};

const MORNING_BY_KIND_EN = {
  robot: MORNING_GREETINGS_EN,
  early: [
    'woke up so early lol, good morning)',
    'up early, hey',
    'couldnt sleep, already awake',
    'eyes just opened, morning',
  ],
  normal: [
    'good morning, how did you sleep)',
    'morning, missed you',
    'heyyy, good morning',
    'morning, woke up and thought of you',
  ],
  oversleep: [
    'overslept hard, just woke up',
    'slept in, morning',
    'sorry, overslept',
    'just opened my eyes, slept in',
  ],
  lunch: [
    'literally woke up around lunch haha',
    'slept till lunch, hey',
    'got up at lunch, morning)',
    'morning, only crawled out around lunch',
  ],
  late: [
    'just woke up, slept in properly',
    'morning, almost slept till lunch',
    'slept almost till lunch, hey',
  ],
};

const NIGHT_BY_KIND_EN = {
  robot: NIGHT_GREETINGS_EN,
  early: [
    'getting sleepy, gonna go to bed',
    'eyes closing, night night',
    'hitting the bed early tonight, good night',
  ],
  half_past: [
    'didnt want to sleep but its already half past twelve, night',
    'could stay up but my eyes are closing',
    'alright im done, stayed up too late, good night)',
  ],
  late: [
    'couldnt sleep but im crashing now',
    'stayed up too late, night',
    'eyes closing on their own, good night',
  ],
  three_am: [
    'its like 3am, im going to sleep',
    'stayed up till three, good night',
    'didnt want to go to bed and here we are, crashing',
  ],
};

function guessGreetingLang(text) {
  if (!text || typeof text !== 'string') return null;
  const letters = text.replace(/[^a-zA-Zа-яёА-ЯЁ]/gi, '');
  if (letters.length < 2) return null;
  const cyr = (letters.match(/[а-яёА-ЯЁ]/gi) || []).length;
  const lat = (letters.match(/[a-zA-Z]/g) || []).length;
  if (lat > cyr) return 'en';
  return 'ru';
}

function pickGreetingPhrases(kind, mood, lang) {
  if (lang === 'en') {
    if (kind === 'night') return NIGHT_BY_KIND_EN[mood] || NIGHT_GREETINGS_EN;
    return MORNING_BY_KIND_EN[mood] || MORNING_GREETINGS_EN;
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
  'эей',
  'ну что молчишь)',
  'ау',
  'хех ты где)',
  'скучно без тебя немного)',
  'напиши как там у тебя',
];
const IDLE_POKE_EN = [
  'hey you alive?',
  'yo',
  'missed you a bit)',
  'u there?',
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

      const lang = await resolveGreetingLang(client, sender, message);
      const bank = lang === 'en' ? IDLE_POKE_EN : IDLE_POKE_RU;
      const phrase = bank[Math.floor(Math.random() * bank.length)];
      const senderName = sender.username || sender.firstName || peerId;
      try {
        await sleep(2500 + Math.random() * 4000);
        await client.sendMessage(sender, { message: phrase });
        await saveMessage(accountId, peerId, senderName, 'assistant', phrase);
        sent += 1;
        console.log(
          `[${accountLabel(accountId)}] Дневная инициатива → ${senderName}: "${phrase}"`,
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
      // (разговор на паузе). Непрочитанные ночью не трогаем.
      // Утром пишем «доброе утро» ВСЕМ недавним; если есть непрочитанный
      // вопрос — следом идёт обычный ответ по теме.
      if (kind === 'night' && !hasUnanswered) continue;

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
    const [rows] = await db.execute(
      `SELECT peer_id, scheduled_at, work_mention_at FROM nft_voice_schedule
       WHERE account_id = ? AND work_mention_sent = 0`,
      [accountId],
    );
    const now = Date.now();
    for (const row of rows) {
      const peerId = String(row.peer_id);
      const scheduledAt = new Date(row.scheduled_at);
      if (!isWorkMentionWindow(scheduledAt, now)) continue;
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
      if (tail.lastRole === 'user') continue;
      let entity;
      try {
        entity = await client.getEntity(Number(peerId));
      } catch (_) {
        continue;
      }
      if (!entity || entity.bot || entity.self) continue;
      if (await shouldSkipProactivePeer(client, entity)) continue;
      if (!(await claimWorkMention(accountId, peerId))) continue;
      const phrase = pickWorkProblemPhrase();
      const senderName = entity.username || entity.firstName || peerId;
      try {
        await sleep(1500 + Math.random() * 2500);
        await client.sendMessage(entity, { message: phrase });
        await saveMessage(accountId, peerId, senderName, 'assistant', phrase);
        console.log(
          `[${accountLabel(accountId)}] Перед NFT-голосовым для ${senderName}: "${phrase}"`,
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
    if (!fs.existsSync(nftPath)) return;
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
          AND last_user_at >= (NOW() - INTERVAL ${Number(NFT_ACTIVE_DIALOGUE_IDLE_HOURS)} HOUR)`,
      [accountId],
    );

    let sent = 0;
    for (const row of rows) {
      if (sent >= 4) break;
      const peerId = String(row.peer_id);
      const dialogKey = bufferKey(accountId, peerId);
      if (processingInFlight.has(dialogKey) || messageBuffers.has(dialogKey)) continue;
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
        sent += 1;
        console.log(
          `[${accountLabel(accountId)}] Отправлено голосовое про NFT (3-й день) для ${senderName}.`,
        );
      } catch (err) {
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

async function rearchiveOurOnlyWorkChats(accountId) {
  const key = accountKey(accountId);
  if (strayArchiveFixInFlight.has(key)) return;
  strayArchiveFixInFlight.add(key);
  try {
    const client = getActiveClient(accountId);
    if (!client) return;
    let listed;
    try {
      listed = await listUserDialogs(client);
    } catch (err) {
      console.error(
        `[${accountLabel(accountId)}] Не смог найти мёртвые чаты:`,
        err.errorMessage || err.message,
      );
      return;
    }

    for (const dialog of listed.dialogs) {
      if (!dialog.isUser || dialog.archived) continue;
      const entity = dialog.entity;
      if (!entity || entity.bot || entity.self) continue;

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
      } catch (_) {
        continue;
      }
      const deleted = isDeletedUser(entity);
      const dead = deleted || !incoming;
      if (!dead) continue;

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
  startLogin,
  confirmCode,
  confirmPassword,
  activateAccount,
  deactivateAccount,
  getActiveClient,
  isActive,
  scanUnansweredDialogs,
  getAccountSettings,
  isWithinWorkingHours,
  isPeerArchived,
  isNeverContact,
  shouldSkipProactivePeer,
  isDeletedUser,
  isPermanentSendError,
  retireUnreachablePeer,
  saveMessage,
  archivePeer,
  NFT_VOICE_AFTER_HOURS,
  getDialogAgeHours,
  };
