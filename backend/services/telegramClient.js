const { TelegramClient, Api } = require('telegram');
const { ConnectionTCPFull } = require('telegram/network');
const { StringSession } = require('telegram/sessions');

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
  transcribeAudio,
  describeImage,
} = require('./aiResponder');
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

// Сколько последних сообщений диалога передавать модели как контекст.
const HISTORY_LIMIT = 20;

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

function buildProxyPool() {
  const pool = [];

  // Новый формат: список
  if (process.env.PROXY_LIST) {
    for (const raw of process.env.PROXY_LIST.split(';')) {
      const entry = raw.trim();
      if (!entry) continue;
      const parsed = parseProxyEntry(entry);
      if (parsed) pool.push(parsed);
    }
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

// Индекс текущего рабочего прокси. Начинаем с найденного при старте.
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
  console.log('[proxy] Прокси не заданы — прямое подключение к Telegram.');
}

// Клиенты ���������������� процессе входа. Ключ: `${userId}:${phone}`
const pendingLogins = new Map();

// Пул активных (рабочих) клиентов. Ключ: accountId, значение: TelegramClient
const activeClients = new Map();

// Буфер склейки сообщений. Если собеседник шлёт несколько сообщений подряд,
// мы ждём коротку�� паузу и отвечаем ОДИН раз на ��се сразу — иначе бот
// отвечает на каждое по отдельности и путается в контексте.
// Ключ: `${accountId}:${peerId}`, значение: { texts, timer, sender, message }.
const messageBuffers = new Map();

// Сколько ждать следующего сообщения перед тем, как ответить (мс).
// Человек часто пишет мысль несколькими сообщениями с паузами — даём ему
// договорить, поэтому окно достаточно большое.
const AGGREGATE_WINDOW_MS = 8000;

// Максимальное общее время накопления серии (мс). Даже если собеседн��к
// продолжает печатать без остановки, после этого лимита бот всё равно ответит.
const AGGREGATE_MAX_WAIT_MS = 45000;

// ---------------------------------------------------------------------------
// «ЖИВОЙ» ИГНОР + РЕ-ЭНГЕЙДЖМЕНТ.
// Иногда бот, вместо того чтобы сразу ответить, ведёт себя как занятой человек:
// молчит некоторое время (10–60 мин), а потом САМ пишет собеседнику вопрос
// («что делаешь?»). Это делает поведение менее «ботским».
// Состояние хранится ТОЛЬКО в памяти процесса: при рестарте таймеры теряются —
// тогда непрочитанный диалог утром/через 5 мин подхватит обычный скан.
// Ключ: `${accountId}:${peerId}` (тот же bufferKey) -> { timer, sender, senderName }.
// ---------------------------------------------------------------------------
const deferredDialogs = new Map();

// Вероятность «замолчать и потом написать самой» вместо обычного ответа (~30–35%).
const DEFER_CHANCE = 0.32;
// Диапазон паузы перед ре-энгейджментом: от 10 минут до 1 часа.
const DEFER_MIN_MS = 10 * 60 * 1000;
const DEFER_MAX_MS = 60 * 60 * 1000;
// Минимальная длина истории, чтобы «занятость» не срабатывала в самом начале
// знакомства (иначе бот проигнорит «привет» и покажется мёртвым).
const DEFER_MIN_HISTORY = 4;
// Если во время паузы собеседник пишет снова — отменяем самостоятельный
// ре-энгейджмент и отвечаем именно на его последнее сообщение через небольшую паузу.
const DEFER_INTERRUPT_DELAY_MS = 2 * 60 * 1000;

// Фразы-вопросы, которыми бот сам возобновляет диалог после паузы.
const REENGAGE_PHRASES = [
  'что делаешь?',
  'ты тут?',
  'как ты там?',
  'чем занят?',
  'эй, живой?)',
  'ну чё, как ты?',
  'скучаешь?)',
  'чё делаешь то?',
  'прив, ты как?',
  'вернулась) ты чем занят?',
  'о, я освободилась, ты тут?',
  'как денёк проходит?',
];

// ---------------------------------------------------------------------------
// РАБОЧИЕ ЧАСЫ (бот отвечает только днём/вечером, ночью молчит).
// По умолчанию 09:00–23:00 по Москве. Можно переопределить в .env:
//   WORK_START_HOUR=9   WORK_END_HOUR=23   WORK_TIMEZONE=Europe/Moscow
// Ночью бот НЕ отвечает; входящие остаются непрочитанными и будут дочитаны
// утром скан-функцией scanUnansweredDialogs (ответит на накопленное).
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

// true, если сейчас рабочее время (бот должен отвечать).
function isWithinWorkingHours() {
  const hour = getWorkZoneHour();
  if (WORK_START_HOUR <= WORK_END_HOUR) {
    return hour >= WORK_START_HOUR && hour < WORK_END_HOUR;
  }
  // На случай «ночного» расписания через полночь (напр. 22–6).
  return hour >= WORK_START_HOUR || hour < WORK_END_HOUR;
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
  const client = new TelegramClient(
    new StringSession(''),
    apiId,
    apiHash,
    clientOptions(),
  );

  await client.connect();

  const { phoneCodeHash } = await client.sendCode({ apiId, apiHash }, phone);

  pendingLogins.set(loginKey(userId, phone), { client, phoneCodeHash });

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

      // Проверяем, что сессия ещё жива
      const authorized = await client.isUserAuthorized();
      if (!authorized) {
        await client.disconnect();
        // Сессия мертва — перебор прокси не поможет, выходим сразу.
        return false;
      }

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

      // Фоном «дочитываем» непрочитанные диалоги, пришедшие пока аккаунт был
      // offline (minAgeSec=0 — live-обработчик их всё равно не видел).
      scanUnansweredDialogs(accountId, 0).catch((e) =>
        console.error(
          `[Аккаунт ${accountId}] Скан при активации не удался:`,
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
        workStateByAccount.set(accountId, isWithinWorkingHours());
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
    }
  }

  console.error(`Аккаунт ${accountId}: все прокси недоступны, подключение не удалось.`);
  return false;
}

/**
 * Останавливает клиент и убирает из пула.
 */
async function deactivateAccount(accountId) {
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

  // Отменяем отложенные «паузы занятости» этого аккаунта, чтобы таймеры не
  // сработали после отключения.
  const prefix = `${accountId}:`;
  for (const [key, entry] of deferredDialogs) {
    if (key.startsWith(prefix)) {
      clearTimeout(entry.timer);
      deferredDialogs.delete(key);
    }
  }
  
  const client = activeClients.get(accountId);
  if (!client) return;

  try {
    await client.disconnect();
  } catch (err) {
    console.error(`Ошибка отключения аккаунта ${accountId}:`, err.message);
  }

  activeClients.delete(accountId);
}

/**
 * Возвращает живой клиент по accountId (или undefined).
 */
function getActiveClient(accountId) {
  return activeClients.get(accountId);
}

/**
 * Проверяет, активен ли аккаунт.
 */
function isActive(accountId) {
  return activeClients.has(accountId);
}

// ---------------------------------------------------------------------------
// ОБРАБОТКА ВХОДЯЩИХ СООБЩЕНИЙ
// ---------------------------------------------------------------------------

/**
 * Возвращает данные аккаунта (промпт, флаг автоответчика и ��иа��аз��н
 * задержки перед ответом) из БД.
 */
async function getAccountSettings(accountId) {
  const [rows] = await db.execute(
  `SELECT prompt, is_autoreply_enabled, reply_delay_min, reply_delay_max, media_chat_link
  FROM accounts WHERE id = ? LIMIT 1`,
  [accountId],
  );
  return rows[0] || null;
}

/** Пауза на указанное число миллисекунд. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Вычисляет случайную задержку (в мс) в диапазоне [min, max] секунд.
 * Значения жёстко ограничиваются рамками 1..60 секунд, чтобы бот всегда
 * отвечал «по-человече��ки» и не завис на слишком долгой паузе.
 */
function pickReplyDelayMs(settings) {
  const clamp = (n, def) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return def;
    return Math.min(60, Math.max(1, Math.round(v)));
  };

  let min = clamp(settings.reply_delay_min, 3);
  let max = clamp(settings.reply_delay_max, 8);
  if (min > max) [min, max] = [max, min];

  const seconds = min + Math.random() * (max - min);
  return Math.round(seconds * 1000);
}

/**
 * Выдерживает случайную паузу перед ответом. Индикатор «печатает...»
 * показывается ТОЛЬКО в последние TYPING_LEAD_MS м��ллисекунд перед отправкой
 * (по умолчанию 10 сек), а до этого бот ждёт молча.
 * Индикатор обновляется каждые ~4 секунды, т.к. Telegram гасит его сам.
 */
async function waitBeforeReply(client, peer, delayMs) {
  const TYPING_LEAD_MS = 10000; // за сколько до отправки включать «печатает»
  const TYPING_REFRESH = 4000;

  // 1. Тихая фаза: ждём без индикатора (если пауза длиннее 10 сек).
  const silentMs = Math.max(0, delayMs - TYPING_LEAD_MS);
  if (silentMs > 0) {
    await sleep(silentMs);
  }

  // 2. Фаза «печатает»: последние до 10 секунд с индикатором набора.
  let typingElapsed = 0;
  const typingMs = Math.min(delayMs, TYPING_LEAD_MS);

  while (typingElapsed < typingMs) {
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
 * Проверяет, лежит ли диалог с эт��м собеседником в АРХИВЕ.
 *
 * В Telegram архив — это системная папка с folder_id = 1. Мы запрашиваем
 * диалог конкретного собеседника и смо��рим, в какой папке он находится.
 * Если в архивной (folderId === 1) — значит пользователь спрятал собеседника
 * и автоответчик отвечать ему не должен.
 *
 * Возвращает true, если диалог в архиве (ну��но ПРОПУСТИТ�� ответ).
 * При любой ошибке возвращает false — в спорных случаях бот всё же ответит,
 * чтобы не «проглотить» со��бщение реального че��овека.
 */
async function isPeerArchived(client, inputPeer) {
  try {
    const result = await client.invoke(
      new Api.messages.GetPeerDialogs({
        peers: [new Api.InputDialogPeer({ peer: inputPeer })],
      }),
    );

    const dialog = result && result.dialogs && result.dialogs[0];
    if (!dialog) return false;

    // folderId === 1 -> архив. undefined/0 -> основной список.
    return dialog.folderId === 1;
  } catch (err) {
    console.error(
      'Не удалось определить папку диалога (пропускаю проверку архива):',
      err.errorMessage || err.message,
    );
    return false;
  }
}

/**
 * Достаёт последние сообщения диалога (в хронологическом порядке).
 */
async function getHistory(accountId, peerId) {
  // ВНИМАНИЕ: mysql2 не умеет подставлять число в `LIMIT ?` через
  // prepared statement (ошибка "Incorrect arguments to mysqld_stmt_execute").
  // HISTORY_LIMIT — наша собственная числовая константа, не пользовательский
  // ввод, поэтому её безопасно встроить в текст запроса напрямую.
  const limit = Number(HISTORY_LIMIT) || 20;
  const [rows] = await db.execute(
    `SELECT role, content FROM conversation_messages
     WHERE account_id = ? AND peer_id = ?
     ORDER BY id DESC
     LIMIT ${limit}`,
    [accountId, peerId],
  );
  // Из БД пришло от новых к старым — разворачиваем в хронологию.
  return rows.reverse();
}

/**
 * Сохраняет одно сообщение диалога в историю.
 */
async function saveMessage(accountId, peerId, peerUsername, role, content) {
  await db.execute(
    `INSERT INTO conversation_messages (account_id, peer_id, peer_username, role, content)
     VALUES (?, ?, ?, ?, ?)`,
    [accountId, peerId, peerUsername, role, content],
  );
}

/**
 * Формирует метку голосового сообщения для хранения в истории.
 * По не�� мы понимае��, какая именно заготовка уже отправлялась собеседнику.
 */
function voiceTag(fileName) {
  return `[голосо��ое: ${fileName}]`;
}

/**
 * Проверяет, отправляли ли мы этому собеседнику КОНКРЕТНУЮ голосовую
 * заготовку раньше. Нужна, чтобы не слать одно и то же голосовое повторно
 * (например, если человек второй раз написал «сво»).
 */
async function wasVoiceSent(accountId, peerId, fileName) {
  const [rows] = await db.execute(
    `SELECT id FROM conversation_messages
     WHERE account_id = ? AND peer_id = ? AND content = ?
     LIMIT 1`,
    [accountId, peerId, voiceTag(fileName)],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// NFT-КАМПАНИЯ (3 дня): мягкие напоминания про заработок на NFT, а на 3-й день —
// голосовое nft.ogg с просьбой помочь с токеном.
//
// Почему это в коде, а не только в промпте: промпт статичен и не знает, сколько
// дней длится знакомство. День считаем от ПЕРВОГО сообщения в диалоге
// (conversation_messages.created_at) и передаём модели готовую подсказку.
// ---------------------------------------------------------------------------

// Имя файла голосового с просьбой помочь с NFT-токеном (кладётся в voices/).
const NFT_VOICE_FILE = 'nft.ogg';
// Голосовое уходит, когда диалогу столько часов (3-й день знакомства).
const NFT_VOICE_AFTER_HOURS = 48;

/**
 * Возвращает, сколько часов прошло с первого сообщения диалога.
 * null — если истории ещё нет или колонка недоступна (кампания просто выключится).
 */
async function getDialogAgeHours(accountId, peerId) {
  try {
    const [rows] = await db.execute(
      `SELECT MIN(created_at) AS started FROM conversation_messages
       WHERE account_id = ? AND peer_id = ?`,
      [accountId, peerId],
    );
    const started = rows[0]?.started;
    if (!started) return null;
    const ms = Date.now() - new Date(started).getTime();
    return ms / (60 * 60 * 1000);
  } catch (err) {
    console.error(
      `[Аккаунт ${accountId}] Не смог посчитать возраст диалога (NFT-кампания выключена):`,
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
         AND created_at > (NOW() - INTERVAL 20 HOUR)
         AND (content LIKE '%нфт%' OR content LIKE '%nft%'
              OR content LIKE '%флип%' OR content LIKE '%токен%')
       LIMIT 1`,
      [accountId, peerId],
    );
    return rows.length > 0;
  } catch (err) {
    console.error(
      `[Аккаунт ${accountId}] Не смог проверить упоминания NFT:`,
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
  const ageHours = await getDialogAgeHours(accountId, peerId);
  // Нет истории/даты — кампанию не ведём. И не начинаем с первых же реплик:
  // сначала обычное знакомство.
  if (ageHours == null || historyLength < 6) return { hint: null, sendVoice: false };

  // 3-й день: пора просить помощи с токеном голосовым.
  if (ageHours >= NFT_VOICE_AFTER_HOURS) {
    return {
      hint:
        'Идёт третий день знакомства. Ты уже рассказывала, что зарабатываешь на NFT. ' +
        'Сейчас тебе нужна небольшая помощь с одним токеном. Ответь коротко и по-человечески: ' +
        'скажи, что как раз возишься с токеном и не уверена, что делаешь правильно, и что сейчас ' +
        'запишешь голосовое и объяснишь. Не проси денег, не давай ссылок, не объясняй детали текстом — ' +
        'детали будут в голосовом. Одна-две короткие фразы, без давления.',
      sendVoice: true,
    };
  }

  // 1–2 день: мягко напоминаем про тему, но не чаще раза в сутки.
  if (await nftMentionedRecently(accountId, peerId)) {
    return { hint: null, sendVoice: false };
  }

  const day = ageHours < 24 ? 1 : 2;
  return {
    hint:
      `Идёт ${day}-й день знакомства. Если получится естественно — ОДИН раз за этот ответ ` +
      'вскользь упомяни, что зарабатываешь на NFT (перепродаёшь токены): например пожалуйся, ' +
      'что залипла в графики, или порадуйся, что сделка вышла удачной. Это фон, а не главная тема: ' +
      'сначала ответь на то, что человек написал. Не объясняй, что такое NFT, если не спрашивают, ' +
      'не уговаривай, не предлагай заработать вместе и не проси ничего. Если по контексту ' +
      'упоминание будет неуместным — просто пропусти его.',
    sendVoice: false,
  };
}

// ---------------------------------------------------------------------------
// МЕДИА (фото/видео/кружки из чата по ссылке)
// ---------------------------------------------------------------------------

// Токены, которые модель вставляет в ответ, когда нужно прислать медиа.
const MEDIA_TOKEN_RE = /<<\s*(?:PHOTO|VIDEO|CIRCLE)\s*>>/gi;

// Шанс, что бот САМ (без просьбы) пришлёт кружок «занимаюсь делами».
const SELF_CIRCLE_CHANCE = 0.08;
// Не чаще одного «самокружка» в этот интервал на собеседника (in-memory).
const SELF_CIRCLE_MIN_INTERVAL_MS = 2 * 60 * 60 * 1000;
const lastSelfCircleAt = new Map(); // `${accountId}:${peerId}` -> timestamp

/**
 * Вырезает из ответа модели медиа-токен и возвращает чистый текст и тип
 * запрошенного медиа ('photo' | 'video' | 'circle' | null).
 */
// Отказные фразы, которые НЕ должны идти вместе с реальной отправкой медиа.
const REFUSAL_RE =
  /(пока рано|попозже|не могу|не буду|не кину|не кидаю|потом|в другой раз|рано ещё|рано еще|не сейчас|стесняюсь)/i;

// Явная просьба прислать медиа. Нужна, чтобы:
//  1) такая просьба имела приоритет над голосовыми заготовками (вариант Б);
//  2) отличать реальный запрос от простого вопроса про уже присланное медиа.
// Требуем И глагол-просьбу («скинь/пришли/покажи/запиши/можешь»), И объект
// («фото/видео/кружок/себя»), чтобы «куда едешь на кружочке?» НЕ считалось просьбой.
const MEDIA_REQUEST_VERB_RE =
  /(скинь|скинешь|кинь|кинешь|пришли|пришлёшь|пришлешь|покажи|покажешь|запиши|запишешь|сфоткай|сфоткайся|сделай|можешь|можно|давай|хочу увидеть|хочу посмотреть|дай посмотреть)/i;
const MEDIA_REQUEST_OBJ_RE =
  /(фото|фотк|фоточк|селфи|видео|видосик|видос|кружок|кружочек|кружочк|себя|как ты выглядишь|как выглядишь|своё лицо|свое лицо|личико)/i;

function isExplicitMediaRequest(text) {
  if (!text) return false;
  return MEDIA_REQUEST_VERB_RE.test(text) && MEDIA_REQUEST_OBJ_RE.test(text);
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
  // (например «неа, пока рано)» + <<PHOTO>>), убираем противореч��вый текст —
  // раз медиа реально уходит, отказ выглядит абсурдно. Оставляем пусто:
  // фото уйдёт со своей случайной дружелюбной подписью.
  if (mediaType && REFUSAL_RE.test(text)) {
    text = '';
  }

  return { text, mediaType };
}

/**
 * Возвращает множество id медиа, которые уже отправлялись этому собеседнику
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
 * Выбирает и отправляет случайное неотправленное медиа нужного типа из
 * медиа-чата аккаунта. Возвращает true, если медиа реально ушло.
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
        `[Аккаунт ${accountId}] В медиа-чате нет медиа типа "${mediaType}" для ${senderName}.`,
      );
      return false;
    }

    try {
      await sendMediaItem(client, sender, item, pickCaption(mediaType));
    } catch (e) {
      // Устаревшая ссылка на файл — сбрасываем кэш и пробуем ещё раз.
      if (String(e.message || '').includes('FILE_REFERENCE')) {
        clearMediaCache(accountId, link);
        record = await getMediaItems(client, accountId, link);
        item = pickUnsentMedia(record.items, mediaType, sentIds) || item;
        await sendMediaItem(client, sender, item, pickCaption(mediaType));
      } else {
        throw e;
      }
    }

    await saveMessage(accountId, peerId, senderName, 'assistant', mediaTag(item.id));
    console.log(
      `[Аккаунт ${accountId}] Отправлено медиа (${mediaType}) #${item.id} для ${senderName}.`,
    );
    return true;
  } catch (err) {
    console.error(
      `[Аккаунт ${accountId}] Ошибка о��правки медиа (${mediaType}): ${err.message}`,
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// «СКОЛЬКО СИДИШЬ» + АВТОАРХИВ ПРИ СРОКЕ БОЛЬШЕ 2 НЕДЕЛЬ
// ---------------------------------------------------------------------------

// Синхронный замок «вопрос уже отправляется» для пары аккаунт+собеседник.
// Защита от гонки: пока идёт пауза перед вопросом, второе входящее
// сообщение не должно отправить тот же вопрос повторно.
const howLongInFlight = new Set();

// Названия платформы — в вопросе используется ОДНО случайное, а не все сразу.
const HOWLONG_PLATFORMS = ['д��', 'сз', 'дайвинчике'];

// Собирает текст вопроса «сколько сидишь» с одним случайным названием.
function buildHowLongQuestion() {
  const place =
    HOWLONG_PLATFORMS[Math.floor(Math.random() * HOWLONG_PLATFORMS.length)];
  return `слушай, а ты давно тут сидишь, на ${place}? сколько уже примерно?`;
}

// После скольких сообщений собеседника задавать вопрос.
const HOWLONG_AFTER_MESSAGES = 3;

/**
 * Проверяет по истории, задавали ли мы уже вопрос «ск��л��ко сидишь»
 * (любой из вариантов — ищем по устойчивой части фразы).
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
 * (строго > 14 дней). Возвращает true, если срок явно бол��ше двух недель.
 *
 * Понимает годы, месяцы, полгода, недели и дни, числа цифрами и словами.
 */
function parseDurationOverTwoWeeks(text) {
  const t = (text || '').toLowerCase();

  // Числ�� словами -> цифры.
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
  if (/(год|года|годи|ле��)/.test(t)) return true;
  if (/(полгода|пол года)/.test(t)) return true;

  // Месяцы — тоже больше 2 недель.
  if (/(месяц|месяца|месяцев|мес\b)/.test(t)) return true;

  // Недели: > 2 недель, либо «больше 2 недель».
  if (/недел/.test(t)) {
    if (num !== null) {
      if (num > 2) return true;
      if (num === 2 && explicitMore) return true;
      return false;
    }
    return false;
  }

  // Дни: больше 14 дней.
  if (/(день|дня|дн��й|дн\b|сутк)/.test(t)) {
    if (num !== null && num > 14) return true;
    return false;
  }

  return false;
}

/**
 * Перемещает диалог с собеседником в АРХИВ (folder_id = 1).
 */
async function archivePeer(client, inputPeer) {
  await client.invoke(
    new Api.folders.EditPeerFolders({
      folderPeers: [
        new Api.InputFolderPeer({ peer: inputPeer, folderId: 1 }),
      ],
    }),
  );
}

/**
 * Проверяет, ��ора ли «невзначай» задать вопрос «сколько сидишь»:
 *   - его ещё не задавали этому собеседнику;
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
async function extractIncomingText(accountId, message, peerId, peerUsername) {
  // 1. Обычный текст (или по��пись отсутствует у медиа).
  const rawText = message.message || '';

  // 2. Голосовое или аудио — расшифровываем.
  if (message.voice || message.audio) {
    const client = getActiveClient(accountId);
    if (!client) return rawText;
    try {
      const buffer = await client.downloadMedia(message, {});
      if (buffer && buffer.length) {
        const transcript = await transcribeAudio(buffer, 'voice.ogg');
        if (transcript) {
          console.log(
            `[Аккаунт ${accountId}] Голосовое расшифровано: "${transcript}"`,
          );
          return `[голосовое сообщение]: ${transcript}`;
        }
      }
    } catch (e) {
      console.error('Не удалось скачать/расшифровать голосовое:', e.message);
    }
    return rawText;
  }

  // 3. Фото — распознаём содержимое, кроме чатов из списка исключений
  // (распознавание для них отключено во всех сессиях пользователя).
  if (message.photo) {
    if (peerId && (await isPhotoRecognitionDisabled(accountId, peerId, peerUsername))) {
      console.log(
        `[Аккаунт ${accountId}] Распознавание фото отключено для этого чата — пропускаю.`,
      );
      return rawText;
    }

    const client = getActiveClient(accountId);
    if (!client) return rawText;
    try {
      const buffer = await client.downloadMedia(message, {});
      if (buffer && buffer.length) {
        const description = await describeImage(buffer, rawText);
        if (description) {
          console.log(
            `[Аккаунт ${accountId}] Фото распознано: "${description}"`,
          );
          const caption = rawText ? ` Подпись: "${rawText}".` : '';
          return `[фото от собеседника]: ${description}.${caption}`;
        }
      }
    } catch (e) {
      console.error('Не удалось скачать/распознать фото:', e.message);
    }
    return rawText;
  }

  // 4. Прочее — возвращаем текст как есть.
  return rawText;
}

/**
 * Приём входящего сообщения. Не отвечает сразу, а кладёт сообщение в буфер
 * и запускает таймер ожидания. Если собеседник за это время пишет ещё —
 * таймер сбрасывается, а тексты копятся, чтобы ответить один раз на все.
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
    if (sender && sender.bot) return;

    const peerId = sender ? String(sender.id) : String(message.senderId);
    const peerUsername = sender ? sender.username : null;
    const senderName = sender
      ? sender.username || sender.firstName || peerId
      : peerId;

    // Фильтр 3: извлекаем текст. Голосовые расшифровываем (Whisper),
    // фото распознаём (vision) — так бот «слышит» и «видит» сообщения.
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

      // Не даём серии тянуться бесконечно: ограничиваем таймер так, чтобы
      // общее ожидание не превысило AGGREGATE_MAX_WAIT_MS.
      const elapsed = Date.now() - existing.startedAt;
      const remaining = Math.max(0, AGGREGATE_MAX_WAIT_MS - elapsed);
      const wait = Math.min(AGGREGATE_WINDOW_MS, remaining);

      existing.timer = setTimeout(
        () => flushMessageBuffer(accountId, peerId, senderName),
        wait,
      );
      console.log(
        `[Аккаунт ${accountId}] +сообщение от ${senderName}, жду паузу (${existing.texts.length} в очереди).`,
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

  // Склеиваем все сообщения серии в один текст (каждое с новой строки).
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
 * Планирует «ре-энгейджмент»: бот замолкает, а через случайные 10–60 минут
 * сам напишет собеседнику вопрос. Если пауза для этого диалога уже идёт —
 * второй раз не планируем.
 */
function scheduleReengage(accountId, sender, peerId, senderName) {
  const key = bufferKey(accountId, peerId);
  if (deferredDialogs.has(key)) return;

  const delay =
    DEFER_MIN_MS + Math.floor(Math.random() * (DEFER_MAX_MS - DEFER_MIN_MS));
  const timer = setTimeout(() => {
    fireReengage(accountId, peerId).catch((e) =>
      console.error(
        `[Аккаунт ${accountId}] Ошибка ре-энгейджмента:`,
        e.message,
      ),
    );
  }, delay);
  // Не держим процесс живым только ради этого таймера.
  if (typeof timer.unref === 'function') timer.unref();

  deferredDialogs.set(key, { timer, sender, senderName });
  console.log(
    `[Аккаунт ${accountId}] «Занята»: молчу ${Math.round(
      delay / 60000,
    )} мин для ${senderName}, потом напишу сама.`,
  );
}

/**
 * Срабатывает по таймеру: бот сам пишет собеседнику вопрос-возобновление
 * («что делаешь?» и т.п.). Проверяет активность, автоответчик и рабочие часы.
 */
async function fireReengage(accountId, peerId) {
  const key = bufferKey(accountId, peerId);
  const entry = deferredDialogs.get(key);
  deferredDialogs.delete(key);
  if (!entry) return;

  const client = getActiveClient(accountId);
  if (!client) return;
  const settings = await getAccountSettings(accountId);
  if (!settings || !settings.is_autoreply_enabled) return;
  // Ночью не пишем — непрочитанное подхватит утренний скан/приветствие.
  if (!isWithinWorkingHours()) return;

  const phrase =
    REENGAGE_PHRASES[Math.floor(Math.random() * REENGAGE_PHRASES.length)];
  try {
    await client.sendMessage(entry.sender, { message: phrase });
    await saveMessage(accountId, peerId, entry.senderName, 'assistant', phrase);
    console.log(
      `[Аккаунт ${accountId}] Ре-энгейджмент для ${entry.senderName}: "${phrase}"`,
    );
  } catch (e) {
    console.error(
      `[Аккаунт ${accountId}] Не удалось отправить ре-энгейджмент ${entry.senderName}:`,
      e.errorMessage || e.message,
    );
  }
}

/**
 * Основн��я логика ответа: фильтр архива, голосовые заготовки,
 * гене����ация AI-ответа с учётом истории и отправка собеседнику.
 * Работает уже со СКЛЕЕННЫМ текстом всех сообщений серии.
 */
async function processBufferedMessages(
  accountId,
  sender,
  message,
  peerId,
  senderName,
  text,
) {
  try {
    // Проверяем настройки аккаунта: автоответчик должен быть включён.
    const settings = await getAccountSettings(accountId);
    if (!settings || !settings.is_autoreply_enabled) {
      console.log(
        `[Аккаунт ${accountId}] Сообщение от ${senderName} получено, но автоответчик выключен.`,
      );
      return;
    }

    // Клиент должен быть активен, чтобы отправить ответ.
    const client = getActiveClient(accountId);
    if (!client) return;

    // Фильтр 4: игнорируем собеседников, спрятанных в АРХИВ.
    const inputPeer = await message.getInputSender();
    if (inputPeer && (await isPeerArchived(client, inputPeer))) {
      console.log(
        `[Аккаунт ${accountId}] Сообщение от ${senderName} получено, но диалог в архиве — не отвечаю.`,
      );
      return;
    }

    // Фильтр 5: рабочие часы. Вне рабочего времени НЕ отвечаем и НЕ сохраняем —
    // сообщение остаётся непрочитанным и будет дочитано утром скан-функцией.
    if (!isWithinWorkingHours()) {
      console.log(
        `[Аккаунт ${accountId}] Сообщение от ${senderName} получено ночью (вне ${WORK_START_HOUR}:00–${WORK_END_HOUR}:00) — отвечу утром.`,
      );
      return;
    }

    console.log(`[Аккаунт ${accountId}] ${senderName}: "${text}"`);

    // 1. Берём историю диалога (до текущего сообщения).
    const history = await getHistory(accountId, peerId);

    // 2. Сохраняем входящее сообщение собеседника.
    await saveMessage(accountId, peerId, senderName, 'user', text);

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
        `[Аккаунт ${accountId}] ${senderName} написал во время паузы — отменяю свой вопрос, отвечу на последнее сообщение через ~2 мин.`,
      );
    }

    // Явная просьба прислать медиа определяется заранее — она нужна и для
    // приоритета над голосовыми, и для медиа-логики ниже.
    const explicitMediaRequest = isExplicitMediaRequest(text);
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
    // ВАРИАНТ Б: если человек ЯВНО просит фото/видео/кружок, а у аккаунта
    // задан медиа-чат — голосовые заготовки НЕ перехватывают запрос. Иначе
    // «запиши кружок, что делаешь» ловилось бы триггером «что делаешь» и
    // уходило голосовое вместо кружка.
    let voice =
      explicitMediaRequest && mediaLinkEarly ? null : findVoiceForText(text);
    if (voice && (await wasVoiceSent(accountId, peerId, voice.fileName))) {
      console.log(
        `[Аккаунт ${accountId}] Голосовое "${voice.fileName}" уже отправлялось ${senderName} — пропус��аю.`,
      );
      // Раньше на voiceOnly-правиле здесь стоял return — и бот молчал совсем:
      // голосовое пропускал, а текст не генерировал (человек оставался без
      // ответа). Теперь в любом случае продолжаем обычный AI-ответ текстом,
      // просто уже без голосового.
      voice = null;
    }

    // Случайная задержка перед ответом (диапазон задаётся в настройках).
    // Если бот «отвлёкся» во время паузы — используем короткую задержку ~2 мин.
    const delayMs =
      forcedDelayMs != null ? forcedDelayMs : pickReplyDelayMs(settings);

    if (voice && voice.voiceOnly) {
      console.log(
        `[Акка��нт ${accountId}] Пауза ${Math.round(delayMs / 1000)}с перед голосовым для ${senderName}.`,
      );
      await waitBeforeReply(client, sender, delayMs);
      await sendVoiceReply(client, sender, voice.filePath);
      await saveMessage(
        accountId,
        peerId,
        senderName,
        'assistant',
        voiceTag(voice.fileName),
      );
      console.log(
        `[Аккаунт ${accountId}] Отправлено только голосовое (без текста) для ${senderName}.`,
      );
      return;
    }

    // 3.5. Фиксированные текстовые ответы по триггеру (��ез обращения к AI).
    // Например, на «что ищешь здесь?» отвечаем заранее заданным текстом.
    const fixedReply = findTextReplyForText(text);
    if (fixedReply) {
      console.log(
        `[Аккаунт ${accountId}] Пауза ${Math.round(delayMs / 1000)}с перед фиксированным ответом для ${senderName}.`,
      );
      await waitBeforeReply(client, sender, delayMs);
      await client.sendMessage(sender, { message: fixedReply });
      await saveMessage(accountId, peerId, senderName, 'assistant', fixedReply);
      console.log(
        `[Аккаунт ${accountId}] Фиксированный ответ для ${senderName}: "${fixedReply}"`,
      );
      return;
    }

    // 3.7. «Живой» игнор: иногда (≈30–35%) вместо обычного ответа бот ведёт
    // себя как занятой человек — молчит, а через 10–60 мин сам напишет вопро��
    // («что делаешь?»). Не срабатывает: на явную просьбу медиа, на голосовые
    // заготовки, при вынужденном ответе (человек написал во время паузы) и в
    // самом начале знакомства (пока история короткая).
    if (
      forcedDelayMs == null &&
      !explicitMediaRequest &&
      !voice &&
      history.length >= DEFER_MIN_HISTORY &&
      Math.random() < DEFER_CHANCE
    ) {
      scheduleReengage(accountId, sender, peerId, senderName);
      return;
    }

    // 4. Генерируем ответ через OpenAI.
    // Медиа-протокол включаем, только если у аккаунта задан чат с медиа —
    // тогда модель может вставить токен <<PHOTO>>/<<VIDEO>>/<<CIRCLE>>.
    const mediaLink = mediaLinkEarly;
    const mediaEnabled = !!mediaLink;

    // NFT-кампания: 1–2 день — мягкое упоминание темы, 3-й день — голосовое.
    const nft = await getNftCampaignState(accountId, peerId, history.length);

    const rawReply = await generateReply(settings.prompt, history, text, {
      mediaEnabled,
      campaignHint: nft.hint,
    });
    if (!rawReply) return;

    // Отделяем текст от запрошенного типа медиа (токен вырезаем из текста).
    const { text: reply, mediaType: rawMediaType } = extractMediaRequest(rawReply);

    // Защита от «медиа два хода подряд»: если модель снова захотела прислать
    // медиа, но прошлый ответ уже был медиа И человек НЕ просил новое явно —
    // подавляем. Так на вопрос «а куда едешь на кружочке?» бот ответит
    // текстом, а не пришлёт ещё один кружок.
    let mediaType = rawMediaType;
    if (mediaType && !explicitMediaRequest && lastAssistantWasMedia(history)) {
      console.log(
        `[Аккаунт ${accountId}] Подавил повторное медиа (${mediaType}) для ${senderName}: прошлый ответ уже был медиа, явной просьбы нет.`,
      );
      mediaType = null;
    }

    // 5. Держим случайную паузу с индикатором «печатает...» — так ответ
    // выглядит живым, а не мгновенным.
    console.log(
      `[Аккаунт ${accountId}] Пауза ${Math.round(delayMs / 1000)}с перед ответом для ${senderName}.`,
    );
    await waitBeforeReply(client, sender, delayMs);

    // 6. Отправляем текстовый ответ (если он есть — модель могла прислать
    // только токен без текста) и сохраняем его в историю.
    // Крайний случай: медиа подавили (см. выше), а текста модель не дала —
    // тогда шлём короткую нейтральную фразу, чтобы не промолчать на вопрос.
    let outText = reply;
    if (!outText && rawMediaType && !mediaType) {
      const fillers = ['да по делам)', 'та так, по своим)', 'ничего особенного)', 'да ничё такого)'];
      outText = fillers[Math.floor(Math.random() * fillers.length)];
    }
    if (outText) {
      await client.sendMessage(sender, { message: outText });
      await saveMessage(accountId, peerId, senderName, 'assistant', outText);
      console.log(`[Аккаунт ${accountId}] Ответ для ${senderName}: "${outText}"`);
    }

    // 6.5. Медиа по запросу модели (фото/видео/кружок из чата по ссылке).
    let mediaSentThisTurn = false;
    if (mediaType && mediaEnabled) {
      // Небольшая пауза + индикатор, чтобы медиа не «прилипало» к тексту.
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
      await sleep(1500 + Math.random() * 1500);
      mediaSentThisTurn = await trySendMedia(
        client,
        sender,
        accountId,
        peerId,
        senderName,
        mediaType,
        mediaLink,
      );
    }

    // 6.6. Изредка бот САМ шлёт кружок «занимаюсь делами» — но не в тот же
    // ход, когда уже отправили медиа, и не чаще раза в заданный интервал.
    if (mediaEnabled && !mediaSentThisTurn) {
      const key = `${accountId}:${peerId}`;
      const last = lastSelfCircleAt.get(key) || 0;
      const cooledDown = Date.now() - last > SELF_CIRCLE_MIN_INTERVAL_MS;
      if (cooledDown && Math.random() < SELF_CIRCLE_CHANCE) {
        await sleep(2000 + Math.random() * 2000);
        const ok = await trySendMedia(
          client,
          sender,
          accountId,
          peerId,
          senderName,
          'circle',
          mediaLink,
        );
        if (ok) lastSelfCircleAt.set(key, Date.now());
      }
    }

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
        // Индикатор не критичен.
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
        `[Аккаунт ${accountId}] Вслед за ответом отправлена голосовая заготовка для ${senderName}.`,
      );
    }

    // 8. Третий день знакомства — голосовое с просьбой помочь с NFT-токеном.
    // Отправляем ОДИН раз за весь диалог (метка в истории) и не в тот же ход,
    // когда уже ушло другое голосовое или медиа — иначе выглядит как спам.
    if (nft.sendVoice && !voice && !mediaSentThisTurn) {
      const nftPath = path.join(VOICES_DIR, NFT_VOICE_FILE);

      if (!fs.existsSync(nftPath)) {
        console.error(
          `[Аккаунт ${accountId}] Файл ${NFT_VOICE_FILE} не найден в voices/ — голосовое про NFT не отправлено.`,
        );
      } else if (await wasVoiceSent(accountId, peerId, NFT_VOICE_FILE)) {
        // Уже просили помощи у этого человека — повторно не шлём.
      } else {
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
        console.log(
          `[Аккаунт ${accountId}] Отправлено голосовое про NFT (3-й день) для ${senderName}.`,
        );
      }
    }
  } catch (err) {
    console.error(
      `Ошибка обработки сообщения (аккаунт ${accountId}):`,
      err.message,
    );
  }
}

// ---------------------------------------------------------------------------
// ДОЧИТЫВАНИЕ НЕПРОЧИТАННЫХ ДИАЛОГОВ (scan)
// Бот проходит по НЕархивным личным диалогам и отвечает тем, чьё последнее
// сообщение осталось без ответа (входящее). Так он «дочитывает» переписки,
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
 *   секундах. Для периодического скана ставим ~90с, чтобы не конфликтовать с
 *   live-обработчиком (он копит и отвечает в пределах ~45с + задержка). Для
 *   скана при активации передаём 0: сообщения, пришедшие до подключения,
 *   live-обраб��тчик всё равно не видел.
 */
async function scanUnansweredDialogs(accountId, minAgeSec = 90) {
  if (scanInFlight.has(accountId)) return;
  scanInFlight.add(accountId);
  try {
    const client = getActiveClient(accountId);
    if (!client) return;

    // Вне рабочих часов не сканируем — дочитаем утром.
    if (!isWithinWorkingHours()) return;

    // Автоответчик должен быть включён.
    const settings = await getAccountSettings(accountId);
    if (!settings || !settings.is_autoreply_enabled) return;

    let dialogs;
    try {
      dialogs = await client.getDialogs({ limit: SCAN_DIALOGS_LIMIT });
    } catch (e) {
      console.error(
        `[Аккаунт ${accountId}] Скан: не удалось получить диалоги:`,
        e.errorMessage || e.message,
      );
      return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    let replied = 0;

    for (const dialog of dialogs) {
      if (replied >= SCAN_MAX_REPLIES) break;

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
      if (!sender || sender.bot || sender.self) continue;

      const peerId = String(sender.id);

      // Если это сообщение сейчас копит live-обработчик — не вмешиваемся.
      if (messageBuffers.has(bufferKey(accountId, peerId))) continue;
      // Если по диалогу идёт «пауза занятости» — не отвечаем, ждём таймер.
      if (deferredDialogs.has(bufferKey(accountId, peerId))) continue;

      // Извлекаем текст последнего входящего (голос -> Whisper, фото -> vision).
      let text;
      try {
        text = await extractIncomingText(accountId, message);
      } catch (_) {
        text = message.message || '';
      }
      if (!text || !text.trim()) continue;

      const senderName = sender.username || sender.firstName || peerId;
      console.log(
        `[Аккаунт ${accountId}] Скан: дочитываю непрочитанный диалог с ${senderName}.`,
      );

      // Переиспользуем основную логику ответа: она сама проверит архив,
      // возьмёт историю, сгенерирует ответ, выдержи�� паузу и отправит.
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
        `[Аккаунт ${accountId}] Скан завершён: отвечено диалогам — ${replied}.`,
      );
    }
  } catch (err) {
    console.error(
      `[Аккаунт ${accountId}] Ошибка скана диалогов:`,
      err.message,
    );
  } finally {
    scanInFlight.delete(accountId);
  }
}

// ---------------------------------------------------------------------------
// ПОЖЕЛАНИЯ «СПОКОЙНОЙ НОЧИ» / «ДОБРОЕ УТРО»
// На ГРАНИЦЕ рабочих часов бот пишет НЕархивным личным диалогам, с кем
// недавно общался (активность за GREETING_RECENT_DAYS дней):
//   день -> ночь  (наступает WORK_END_HOUR):   «спокойной ночи»
//   ночь -> день  (наступает WORK_START_HOUR):  «доброе утро»
// Ночью пишем ТОЛЬКО тем, где последнее слово за нами (разговор на паузе);
// непрочитанные вопросы ночью не трогаем.
// Утром пишем «доброе утро» ВСЕМ недавним, и если человек написал ночью и
// ждёт ответа — СЛЕДОМ (вторым сообщением) отвечаем ему по теме.
// ---------------------------------------------------------------------------

// Варианты фраз (случайный выбор — чтобы не выглядело шаблонно).
const NIGHT_GREETINGS = [
  'спокойной ночи)',
  'ладно, спать пора, споки',
  'всё, отрубаюсь, сладких снов',
  'пойду спать, споки-споки',
  'доброй ночи, до завтра',
];
const MORNING_GREETINGS = [
  'доброе утро)',
  'утро доброе, как спалось',
  'привееет, с добрым утром',
  'доброе, проснулась вот',
  'утречко доброе)',
];

// Кому писать: диалоги с активностью за последние N дней.
const GREETING_RECENT_DAYS = 3;
// Максимум приветствий за один переход (антифлуд Telegram).
const GREETING_MAX_DIALOGS = 15;

// Последнее состояние «рабочее время?» по аккаунту — для детекта перехода.
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

/**
 * Рассылает приветствие ('night' | 'morning') недавним активным диалогам.
 */
async function sendGreetings(accountId, kind) {
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
        `[Аккаунт ${accountId}] Приветствия: не удалось получить диалоги:`,
        e.errorMessage || e.message,
      );
      return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const recentThreshold = nowSec - GREETING_RECENT_DAYS * 24 * 3600;
    const phrases = kind === 'night' ? NIGHT_GREETINGS : MORNING_GREETINGS;
    let sent = 0;

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
      if (kind === 'night' && hasUnanswered) continue;

      const sender = dialog.entity;
      if (!sender || sender.bot || sender.self) continue;

      const peerId = String(sender.id);
      if (messageBuffers.has(bufferKey(accountId, peerId))) continue;
      // По диалогу с активной паузой занятости приветствие не шлём.
      if (deferredDialogs.has(bufferKey(accountId, peerId))) continue;

      const senderName = sender.username || sender.firstName || peerId;
      const phrase = pickRandom(phrases);
      try {
        // Небольшая человеческая пауза между отправками (антифлуд).
        await sleep(2000 + Math.random() * 4000);
        await client.sendMessage(sender, { message: phrase });
        await saveMessage(accountId, peerId, senderName, 'assistant', phrase);
        sent += 1;
      } catch (e) {
        console.error(
          `[Аккаунт ${accountId}] Не удалось отправить приветствие ${senderName}:`,
          e.errorMessage || e.message,
        );
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
            `[Аккаунт ${accountId}] Утро: отвечаю на ночное сообщение ${senderName}.`,
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
        `[Аккаунт ${accountId}] Разослано «${label}» диалогам — ${sent}.`,
      );
    }
  } catch (err) {
    console.error(
      `[Аккаунт ${accountId}] Ошибка рассылки приветствий:`,
      err.message,
    );
  } finally {
    greetingInFlight.delete(accountId);
  }
}

/**
 * Проверяет переход через границу рабочих часов и шлёт приветствие.
 * Вызывается по таймеру раз в минуту.
 */
function checkWorkBoundary(accountId) {
  const nowWorking = isWithinWorkingHours();
  const prev = workStateByAccount.get(accountId);
  // П��рвый вызов (после активации) — только запоминаем, без приветствия,
  // чтобы рестарт среди дня/ночи не ра��сылал сообщения зря.
  if (prev === undefined) {
    workStateByAccount.set(accountId, nowWorking);
    return;
  }
  if (prev === nowWorking) return;

  workStateByAccount.set(accountId, nowWorking);
  if (nowWorking) {
    // ночь -> день: доброе утро (потом скан ответит на ночные вопросы).
    sendGreetings(accountId, 'morning').catch(() => {});
  } else {
    // день -> ночь: спокойной ночи.
    sendGreetings(accountId, 'night').catch(() => {});
  }
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
};
