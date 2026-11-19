/**
 * Пулы прокси для GramJS.
 * Work/DC — activeClients, медиа, OpenAI SOCKS.
 * Login/residential — только sendCode / QR connect (через loginAuth).
 */
const path = require('path');
const fs = require('fs');
const { ConnectionTCPFull } = require('telegram/network');

// GramJS при первом подключении жёстко использует порт 80 (useWSS запрещён с
// прокси). Многие SOCKS5 блокируют 80, но пропускают 443.
class ConnectionTCPFull443 extends ConnectionTCPFull {
  constructor(params) {
    super({ ...params, port: 443 });
  }
}

const DEFAULT_PROXY_FILE = path.join(__dirname, '..', 'config', 'proxies.txt');
const DEFAULT_LOGIN_PROXY_FILE = path.join(__dirname, '..', 'config', 'proxies-login.txt');

function normalizeMtSecret(rawSecret, label) {
  if (!rawSecret) {
    console.warn(`[proxy] MTProxy ${label}: секрет отсутствует — пропущен.`);
    return null;
  }

  let s = rawSecret.trim().toLowerCase();

  if (/^[0-9a-f]{32}$/.test(s)) return s;
  if (/^dd[0-9a-f]{32}$/.test(s)) return s.slice(2);

  if (s.startsWith('ee')) {
    console.warn(
      `[proxy] MTProxy ${label}: секрет FakeTLS (ee...) не поддерживается GramJS — пропущен. Нужен базовый или dd-секрет, либо SOCKS5.`,
    );
    return null;
  }

  console.warn(`[proxy] MTProxy ${label}: неподдерживаемый формат секрета — пропущен.`);
  return null;
}

function parseProxyEntry(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(
    /^(socks5?|SOCKS5?):\/\/(?:([^:@/?#]+):([^@/?#]*)@)?([^:/?#]+):(\d+)\/?$/i,
  );
  if (urlMatch) {
    const [, , user, pass, ip, port] = urlMatch;
    const proxy = { ip, port: Number(port), socksType: 5, timeout: 8 };
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
    if (!secret) return null;

    return { ip, port: Number(port), MTProxy: true, secret, timeout: 8 };
  }

  if (type === 'socks5' || type === 'socks') {
    const [, ip, port, user, pass] = parts;
    if (!ip || !port) return null;
    const proxy = { ip, port: Number(port), socksType: 5, timeout: 8 };
    if (user) proxy.username = user;
    if (pass) proxy.password = pass;
    return proxy;
  }

  console.warn(`[proxy] Неизвестный тип прокси в записи "${raw}" — пропущена.`);
  return null;
}

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

const PROXY_POOL = buildProxyPoolFromList(process.env.PROXY_LIST, readProxyFile(workProxyFile, 'work'), {
  includeLegacy: true,
});

const LOGIN_PROXY_POOL = buildProxyPoolFromList(
  process.env.PROXY_LIST_LOGIN,
  readProxyFile(loginProxyFile, 'login'),
);

// Не стартуем всегда с [0]: первый в списке часто дохлый (ECONNREFUSED),
// а openai/gramjs сначала бьются в него. Случайный старт + ротация кандидатов.
let currentProxyIndex =
  PROXY_POOL.length > 1 ? Math.floor(Math.random() * PROXY_POOL.length) : 0;

/** ip:port → unix ms до которого прокси считается мёртвым (TG+OpenAI) */
const deadUntil = new Map();
/** TG warm/probe weak — не для OpenAI, только GramJS candidates */
const tgWeakKeys = new Set();
const DEFAULT_DEAD_TTL_MS = Number(process.env.PROXY_DEAD_TTL_MS) || 12 * 60 * 1000;

function getCurrentProxyIndex() {
  return currentProxyIndex;
}

function setCurrentProxyIndex(index) {
  currentProxyIndex = Number(index) || 0;
}

function proxyLabel(p) {
  return `${p.MTProxy ? 'mtproxy' : 'socks5'} ${p.ip}:${p.port}`;
}

function proxyKey(p) {
  if (!p) return '';
  return `${p.ip}:${p.port}`;
}

function isProxyDead(p) {
  if (!p) return true;
  const until = deadUntil.get(proxyKey(p));
  if (!until) return false;
  if (Date.now() >= until) {
    deadUntil.delete(proxyKey(p));
    return false;
  }
  return true;
}

function isTgWeak(p) {
  return !!(p && tgWeakKeys.has(proxyKey(p)));
}

function isTgUnusable(p) {
  return isProxyDead(p) || isTgWeak(p);
}

function nextLiveIndex(from = 0, pool = PROXY_POOL) {
  if (!pool.length) return null;
  const start = ((Number(from) || 0) % pool.length + pool.length) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const idx = (start + i) % pool.length;
    if (!isTgUnusable(pool[idx])) return idx;
  }
  // Все TG-weak/dead — любой не-dead для крайней попытки.
  for (let i = 0; i < pool.length; i++) {
    const idx = (start + i) % pool.length;
    if (!isProxyDead(pool[idx])) return idx;
  }
  return null;
}

/**
 * Сразу выкидываем мёртвый прокси из ротации и переключаемся на следующий живой.
 */
function markProxyDead(proxyOrIndex, reason = '', ttlMs = DEFAULT_DEAD_TTL_MS) {
  const p =
    typeof proxyOrIndex === 'number' ? PROXY_POOL[proxyOrIndex] : proxyOrIndex;
  if (!p || !p.ip) return;
  const key = proxyKey(p);
  const until = Date.now() + Math.max(30_000, Number(ttlMs) || DEFAULT_DEAD_TTL_MS);
  deadUntil.set(key, until);
  const mins = Math.round((until - Date.now()) / 60000);
  console.warn(
    `[proxy] DEAD ${proxyLabel(p)} → skip ~${mins}м${reason ? ` (${String(reason).slice(0, 80)})` : ''}`,
  );
  const next = nextLiveIndex(currentProxyIndex + 1);
  if (next != null && next !== currentProxyIndex) {
    setCurrentProxyIndex(next);
    console.log(`[proxy] Work: сразу на ${proxyLabel(PROXY_POOL[next])}`);
  }
}

function markProxyDeadByHost(host, port, reason = '', ttlMs = DEFAULT_DEAD_TTL_MS) {
  const h = String(host || '');
  const pNum = Number(port);
  const found = PROXY_POOL.find(
    (p) => p && p.ip === h && (!pNum || Number(p.port) === pNum),
  );
  if (found) markProxyDead(found, reason, ttlMs);
}

/** Сброс DEAD-карты — между bootstrap-аккаунтами, иначе 1 flap выжигает весь warm-OK. */
function clearDeadProxies() {
  deadUntil.clear();
}

function reviveProxy(proxyOrIndex) {
  const p =
    typeof proxyOrIndex === 'number' ? PROXY_POOL[proxyOrIndex] : proxyOrIndex;
  if (!p || !p.ip) return;
  deadUntil.delete(proxyKey(p));
}

function isProxyTransportError(err) {
  // OpenAI SDK: APIConnectionError → message "Connection error." (без ECONN*) —
  // раньше не матчилось → failover не крутился, тишина + silence-heal loop.
  const name = String((err && (err.name || err.constructor?.name)) || '');
  if (/APIConnectionError|FetchError|ConnectTimeout|SocksClientError/i.test(name)) {
    return true;
  }
  const code = String((err && (err.code || err.cause?.code)) || '');
  if (
    /ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|UND_ERR|ENOTFOUND/i.test(
      code,
    )
  ) {
    return true;
  }
  const msg = String((err && (err.message || err.errorMessage)) || err || '');
  return /timed out|timeout|ECONN|ENETUNREACH|EHOSTUNREACH|SocksClient|socket hang up|Proxy connection|network|fetch failed|UND_ERR|connection failed|Connection error|Not connected|Connection closed while receiving|connect ETIMEDOUT|socket disconnected/i.test(
    msg,
  );
}

/** #28: пачка Not connected → mark current work proxy dead + rotate */
let notConnectedBurst = 0;
let notConnectedWindowAt = 0;
function noteNotConnectedBurst(reason = 'Not connected') {
  const now = Date.now();
  if (now - notConnectedWindowAt > 90_000) {
    notConnectedBurst = 0;
    notConnectedWindowAt = now;
  }
  notConnectedBurst += 1;
  if (notConnectedBurst < 8) return false;
  notConnectedBurst = 0;
  try {
    markProxyDead(currentProxyIndex, `burst:${String(reason).slice(0, 40)}`, DEFAULT_DEAD_TTL_MS);
    return true;
  } catch (_) {
    return false;
  }
}

function poolCandidates(pool, startIndex, extra = {}) {
  // 1 = одна попытка в MTProtoSender (0 = цикл не бежит и connect() → false без ошибки).
  const base = { connectionRetries: 1, ...extra };
  if (!pool.length) return [base];

  const liveIdx = [];
  const weakIdx = [];
  for (let i = 0; i < pool.length; i++) {
    if (isProxyDead(pool[i])) continue;
    if (isTgWeak(pool[i])) weakIdx.push(i);
    else liveIdx.push(i);
  }
  // TG-OK сначала; weak — только если OK нет, и не больше 2 (иначе 15×deadline).
  const WEAK_FALLBACK_CAP = 2;
  const orderedIdx = [];
  let prefer = liveIdx;
  if (!prefer.length) prefer = weakIdx.slice(0, WEAK_FALLBACK_CAP);
  if (!prefer.length) return [base];
  const start = ((Number(startIndex) || 0) % prefer.length + prefer.length) % prefer.length;
  for (let i = 0; i < prefer.length; i++) {
    orderedIdx.push(prefer[(start + i) % prefer.length]);
  }

  return orderedIdx.map((idx) => ({
    opts: { ...base, proxy: pool[idx], connection: ConnectionTCPFull443 },
    index: idx,
    pool,
  }));
}

function connectionCandidates(extra = {}) {
  return poolCandidates(PROXY_POOL, currentProxyIndex, extra);
}

/**
 * Только login / sendCode / QR.
 * Не вызывать из activateAccount и медиа — иначе residential сожрёт ГБ.
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

function clientOptions(extra = {}) {
  const opts = { connectionRetries: 1, ...extra };
  if (PROXY_POOL.length > 0) {
    const live = nextLiveIndex(currentProxyIndex);
    if (live != null) {
      currentProxyIndex = live;
      opts.proxy = PROXY_POOL[currentProxyIndex];
      opts.connection = ConnectionTCPFull443;
    }
    // все DEAD — без proxy (как poolCandidates), не цепляем труп
  }
  return opts;
}

/**
 * Probe socks → Telegram DC :443 (батчи, без markProxyDead — OpenAI те же хосты).
 * Переставляет PROXY_POOL: живые вперёд. currentProxyIndex = 0.
 */
async function warmProbeWorkProxies({ timeoutMs = 7000, concurrency = 4 } = {}) {
  if (!PROXY_POOL.length) return { ok: 0, fail: 0, firstOk: null };
  let SocksClient;
  try {
    ({ SocksClient } = require('socks'));
  } catch (err) {
    console.warn(`[proxy] Warm probe: socks не загрузился (${err.message})`);
    return { ok: 0, fail: 0, firstOk: null };
  }

  const dests = [
    { host: '149.154.167.51', port: 443 },
    { host: '149.154.175.54', port: 443 },
  ];
  console.log(`[proxy] Warm TG probe: ${PROXY_POOL.length} (batch=${concurrency})…`);

  async function probeOne(p) {
    if (p.MTProxy) return true;
    const proxy = {
      host: p.ip,
      port: Number(p.port),
      type: 5,
      userId: p.username,
      password: p.password,
    };
    for (const destination of dests) {
      try {
        const info = await SocksClient.createConnection({
          proxy,
          command: 'connect',
          destination,
          timeout: timeoutMs,
        });
        try {
          info.socket.destroy();
        } catch (_) {}
        return true;
      } catch (_) {}
    }
    return false;
  }

  const flags = new Array(PROXY_POOL.length).fill(false);
  for (let i = 0; i < PROXY_POOL.length; i += concurrency) {
    const slice = PROXY_POOL.slice(i, i + concurrency);
    const part = await Promise.all(slice.map((p) => probeOne(p)));
    for (let j = 0; j < part.length; j++) flags[i + j] = part[j];
  }

  const okList = [];
  const failList = [];
  for (let i = 0; i < PROXY_POOL.length; i++) {
    if (flags[i]) okList.push(PROXY_POOL[i]);
    else failList.push(PROXY_POOL[i]);
  }
  PROXY_POOL.length = 0;
  tgWeakKeys.clear();
  for (const p of okList) PROXY_POOL.push(p);
  for (const p of failList) {
    PROXY_POOL.push(p);
    tgWeakKeys.add(proxyKey(p));
  }
  setCurrentProxyIndex(0);

  const ok = okList.length;
  const fail = failList.length;
  console.log(
    `[proxy] Warm TG: OK ${ok}/${ok + fail}${
      ok ? `, first=${proxyLabel(PROXY_POOL[0])}` : ', none live'
    }${fail ? `; TG-weak last: ${fail}` : ''}`,
  );
  return { ok, fail, firstOk: ok ? 0 : null };
}

/**
 * Быстрый probe login/residential перед QR/SMS.
 * Живые DC вперёд; мёртвые в хвост + tgWeak (не трогаем work PROXY_LIST).
 */
async function warmProbeLoginProxies({
  timeoutMs = 3200,
  concurrency = 4,
  limit = 12,
} = {}) {
  if (!LOGIN_PROXY_POOL.length) return { ok: 0, fail: 0, probed: 0 };
  let SocksClient;
  try {
    ({ SocksClient } = require('socks'));
  } catch (err) {
    console.warn(`[proxy] Login probe: socks не загрузился (${err.message})`);
    return { ok: 0, fail: 0, probed: 0 };
  }
  const dests = [
    { host: '149.154.167.51', port: 443 },
    { host: '149.154.175.54', port: 443 },
  ];
  const n = Math.min(LOGIN_PROXY_POOL.length, Math.max(4, Number(limit) || 12));
  const slice = LOGIN_PROXY_POOL.slice(0, n);
  console.log(`[proxy] Login DC probe: ${slice.length}/${LOGIN_PROXY_POOL.length}…`);

  async function probeOne(p) {
    if (!p || p.MTProxy) return true;
    const proxy = {
      host: p.ip,
      port: Number(p.port),
      type: 5,
      userId: p.username,
      password: p.password,
    };
    for (const destination of dests) {
      try {
        const info = await SocksClient.createConnection({
          proxy,
          command: 'connect',
          destination,
          timeout: timeoutMs,
        });
        try {
          info.socket.destroy();
        } catch (_) {}
        return true;
      } catch (_) {}
    }
    return false;
  }

  const flags = new Array(slice.length).fill(false);
  for (let i = 0; i < slice.length; i += concurrency) {
    const batch = slice.slice(i, i + concurrency);
    const part = await Promise.all(batch.map((p) => probeOne(p)));
    for (let j = 0; j < part.length; j++) flags[i + j] = part[j];
  }

  const okList = [];
  const failList = [];
  for (let i = 0; i < slice.length; i++) {
    if (flags[i]) okList.push(slice[i]);
    else failList.push(slice[i]);
  }
  const rest = LOGIN_PROXY_POOL.slice(n);
  LOGIN_PROXY_POOL.length = 0;
  for (const p of okList) LOGIN_PROXY_POOL.push(p);
  for (const p of rest) LOGIN_PROXY_POOL.push(p);
  for (const p of failList) {
    LOGIN_PROXY_POOL.push(p);
    tgWeakKeys.add(proxyKey(p));
  }
  console.log(
    `[proxy] Login DC: OK ${okList.length}/${slice.length}${
      failList.length ? `, weak ${failList.length}` : ''
    }`,
  );
  return { ok: okList.length, fail: failList.length, probed: slice.length };
}

/** GramJS иногда кидает SocksClientError в unhandledRejection — ловим и помечаем DEAD. */
function installSocksDeadHook() {
  if (global.__loverussianSocksDeadHook) return;
  global.__loverussianSocksDeadHook = true;
  process.on('unhandledRejection', (reason) => {
    try {
      const msg = String(
        (reason && (reason.message || reason.errorMessage || reason)) || '',
      );
      if (!/SocksClient|Proxy connection|timed out|ECONN/i.test(msg)) return;
      const px = reason && reason.options && reason.options.proxy;
      const host = px && px.host;
      const port = px && px.port;
      // Flap: не 12м — иначе warm-OK пул выгорает на unhandled SocksClient.
      if (host) {
        const found = PROXY_POOL.find(
          (p) => p && p.ip === host && (!port || Number(p.port) === Number(port)),
        );
        if (found) markProxyDead(found, msg.slice(0, 80), 60_000);
      }
    } catch (_) {}
  });
}

installSocksDeadHook();

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

module.exports = {
  ConnectionTCPFull443,
  PROXY_POOL,
  LOGIN_PROXY_POOL,
  getCurrentProxyIndex,
  setCurrentProxyIndex,
  proxyLabel,
  proxyKey,
  isProxyDead,
  isTgWeak,
  isTgUnusable,
  nextLiveIndex,
  markProxyDead,
  markProxyDeadByHost,
  clearDeadProxies,
  reviveProxy,
  isProxyTransportError,
  noteNotConnectedBurst,
  poolCandidates,
  connectionCandidates,
  loginConnectionCandidates,
  warmProbeLoginProxies,
  clientOptions,
  warmProbeWorkProxies,
  installSocksDeadHook,
  parseProxyEntry,
  normalizeMtSecret,
};
