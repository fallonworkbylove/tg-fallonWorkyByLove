/**
 * Масштаб / воркеры / железо: busy в БД, волны бута, нагрузка,
 * чеклист AI, статусы, задачи воркера, шаблоны персонажей, пулы по ролям.
 */
const fs = require('fs');
const path = require('path');
const db = require('../db');

const BOOT_WAVE_SIZE = Math.max(1, Number(process.env.BOOT_WAVE_SIZE) || 8);
const BOOT_WAVE_MS = Math.max(500, Number(process.env.BOOT_WAVE_MS) || 2500);
const LOAD_SOFT_PER_HOUR = Math.max(20, Number(process.env.LOAD_SOFT_PER_HOUR) || 45);
const LOAD_HARD_PER_HOUR = Math.max(LOAD_SOFT_PER_HOUR + 5, Number(process.env.LOAD_HARD_PER_HOUR) || 70);
const LOGIN_MIN = Math.max(5, Number(process.env.LOGIN_PROXY_MIN) || 15);
const MIN_PROXY_LEN = Math.max(3, Number(process.env.MIN_PROXY_LEN) || 5);

let tablesReady = null;

async function ensureTables() {
  if (tablesReady) return tablesReady;
  tablesReady = (async () => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS busy_deferred (
        account_id BIGINT NOT NULL,
        peer_id VARCHAR(64) NOT NULL,
        sender_name VARCHAR(255) NULL,
        user_text TEXT NULL,
        due_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (account_id, peer_id),
        KEY idx_busy_due (due_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS worker_tasks (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        account_id BIGINT NULL,
        peer_id VARCHAR(64) NULL,
        kind VARCHAR(40) NOT NULL,
        title VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        due_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME NULL,
        KEY idx_wt_status (status, due_at),
        KEY idx_wt_acc (account_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  })();
  return tablesReady;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** #3 волны бута */
async function activateInWaves(rows, activateFn, { waveSize = BOOT_WAVE_SIZE, waveMs = BOOT_WAVE_MS } = {}) {
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < rows.length; i++) {
    const account = rows[i];
    try {
      const result = await activateFn(account);
      if (result === true) ok += 1;
      else fail += 1;
    } catch (_) {
      fail += 1;
    }
    if ((i + 1) % waveSize === 0 && i + 1 < rows.length) {
      console.log(`[bootstrap] волна ${i + 1}/${rows.length}, пауза ${waveMs}мс`);
      await sleep(waveMs);
    }
  }
  return { ok, fail, total: rows.length };
}

/** #12 persist busy */
async function persistBusy({ accountId, peerId, senderName, text, delayMs }) {
  await ensureTables();
  const due = new Date(Date.now() + Math.max(60_000, delayMs || 5 * 60_000));
  await db.execute(
    `INSERT INTO busy_deferred (account_id, peer_id, sender_name, user_text, due_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE sender_name=VALUES(sender_name), user_text=VALUES(user_text), due_at=VALUES(due_at)`,
    [accountId, String(peerId), String(senderName || '').slice(0, 250), String(text || '').slice(0, 4000), due],
  );
}

async function clearBusy(accountId, peerId) {
  await ensureTables();
  await db.execute(`DELETE FROM busy_deferred WHERE account_id = ? AND peer_id = ?`, [
    accountId,
    String(peerId),
  ]);
}

async function clearBusyForAccount(accountId) {
  await ensureTables();
  await db.execute(`DELETE FROM busy_deferred WHERE account_id = ?`, [accountId]);
}

/**
 * После бута: вернуть due-строки в память через schedule callback.
 * callback(row) должен поставить таймер fireReengage.
 */
async function restoreBusyFromDb(scheduleFn) {
  await ensureTables();
  const [rows] = await db.execute(
    `SELECT account_id, peer_id, sender_name, user_text, due_at
     FROM busy_deferred
     WHERE due_at > NOW() - INTERVAL 2 HOUR
     ORDER BY due_at ASC
     LIMIT 200`,
  );
  let n = 0;
  for (const row of rows) {
    const dueMs = new Date(row.due_at).getTime() - Date.now();
    const delayMs = Math.max(5_000, dueMs);
    try {
      await scheduleFn({
        accountId: row.account_id,
        peerId: row.peer_id,
        senderName: row.sender_name || row.peer_id,
        text: row.user_text || '',
        delayMs,
        fromDb: true,
      });
      n += 1;
    } catch (e) {
      console.warn('[scaleOps] restore busy:', e.message);
    }
  }
  if (n) console.log(`[scaleOps] восстановлено «Занята» из БД: ${n}`);
  return n;
}

/** Час МСК 0–23 — волны busy: ночь длиннее, день короче. */
function mskHourNow(date = new Date()) {
  const msk = new Date(date.getTime() + 3 * 3600 * 1000);
  return msk.getUTCHours();
}

/**
 * #24 разные «занята» + волны по часу МСК:
 * ночь (1–8) → длиннее, вечер пик → чуть короче.
 */
function pickBusyDelayMs({ userText = '', explicitMedia = false, historyLen = 0 } = {}) {
  const u = String(userText || '');
  const hot =
    explicitMedia ||
    /[?]/.test(u) ||
    /(?:видео|круж|фот|лайф|переезд|когда)/i.test(u);
  const hour = mskHourNow();
  const night = hour >= 1 && hour < 8;
  const eveningPeak = hour >= 18 && hour < 23;
  let base;
  if (hot) {
    base = (2 * 60 + Math.floor(Math.random() * 4 * 60)) * 1000;
  } else if (historyLen >= 20) {
    base = (8 * 60 + Math.floor(Math.random() * 12 * 60)) * 1000;
  } else {
    base = (5 * 60 + Math.floor(Math.random() * 13 * 60)) * 1000;
  }
  if (night) return Math.round(base * 1.45);
  if (eveningPeak) return Math.round(base * 0.85);
  return base;
}

/** #4 карта нагрузки */
async function accountHourLoad(accountId) {
  const [[row]] = await db.execute(
    `SELECT COUNT(*) c FROM conversation_messages
     WHERE account_id = ? AND role = 'assistant'
       AND created_at > NOW() - INTERVAL 1 HOUR
       AND content NOT LIKE '[медиа:%' AND content NOT LIKE '[реакция:%'`,
    [accountId],
  );
  return Number(row.c) || 0;
}

async function loadThrottleState(accountId) {
  const n = await accountHourLoad(accountId);
  // мягче: раньше hard давал +20–45с и живой чат «тупил»
  if (n >= LOAD_HARD_PER_HOUR) return { level: 'hard', count: n, extraDelayMs: 6_000 + Math.random() * 6_000 };
  if (n >= LOAD_SOFT_PER_HOUR) return { level: 'soft', count: n, extraDelayMs: 3_000 + Math.random() * 4_000 };
  return { level: 'ok', count: n, extraDelayMs: 0 };
}

/** #23 ритм пачек — по lastReply timestamps в памяти */
const burstHits = new Map(); // key -> number[] timestamps

function noteBurstReply(accountId, peerId) {
  const key = `${accountId}:${peerId}`;
  const now = Date.now();
  const arr = (burstHits.get(key) || []).filter((t) => now - t < 3 * 60_000);
  arr.push(now);
  burstHits.set(key, arr);
}

function burstExtraDelayMs(accountId, peerId) {
  const key = `${accountId}:${peerId}`;
  const now = Date.now();
  const arr = (burstHits.get(key) || []).filter((t) => now - t < 3 * 60_000);
  burstHits.set(key, arr);
  // было +8–25с / +5–13с → чат «замирал»; держим лёгкий человеческий люфт
  if (arr.length >= 3) return 3_000 + Math.floor(Math.random() * 5_000);
  if (arr.length >= 2 && now - arr[arr.length - 1] < 12_000) return 1_500 + Math.floor(Math.random() * 3_000);
  return 0;
}

/** #5 / #15 пулы — unique строки (копипаст-дубли не раздувают loginOk) */
function countLoginProxies() {
  const candidates = [
    path.join(__dirname, '..', 'config', 'proxies-login.txt'),
    process.env.LOGIN_PROXY_FILE || '',
  ].filter(Boolean);
  for (const f of candidates) {
    try {
      if (!fs.existsSync(f)) continue;
      const lines = fs
        .readFileSync(f, 'utf8')
        .split(/\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && /socks5/i.test(l));
      return new Set(lines.map((l) => l.toLowerCase())).size;
    } catch (_) {}
  }
  return 0;
}

function getPoolRoleCounts() {
  const work = String(process.env.PROXY_LIST || '')
    .split(';')
    .filter((x) => x.trim()).length;
  let workLive = work;
  try {
    const { PROXY_POOL } = require('./proxyPools');
    workLive = Math.max(workLive, (PROXY_POOL && PROXY_POOL.length) || 0);
  } catch (_) {}
  const openai = String(process.env.OPENAI_PROXY_LIST || process.env.PROXY_LIST || '')
    .split(';')
    .filter((x) => x.trim()).length;
  const login = countLoginProxies();
  return {
    work: workLive,
    login,
    openai,
    workMin: MIN_PROXY_LEN,
    loginMin: LOGIN_MIN,
    workOk: workLive >= MIN_PROXY_LEN,
    loginOk: login >= LOGIN_MIN,
  };
}

/** #9 чеклист + #7 статус */
function checklistForAccount(account, { online = false, mediaOk = null } = {}) {
  const promptOk = !!(account.prompt && String(account.prompt).trim().length >= 40);
  // Список аккаунтов в API не отдаёт session_string — только has_session / length.
  const sessionOk = !!(
    account.has_session === 1 ||
    account.has_session === true ||
    account.hasSession === true ||
    (Number(account.session_len) > 50) ||
    (account.session_string && String(account.session_string).length > 50)
  );
  const mediaLinkOk =
    mediaOk != null
      ? !!mediaOk
      : !!(account.media_chat_link && String(account.media_chat_link).trim());
  const missing = [];
  if (!promptOk) missing.push('промпт');
  if (!sessionOk) missing.push('сессия');
  if (!mediaLinkOk) missing.push('медиа-чат');
  let state = 'ok';
  if (!sessionOk) state = 'no_session';
  else if (!online) state = 'offline';
  else if (!promptOk) state = 'no_prompt';
  else if (!mediaLinkOk) state = 'no_media';
  else if (Number(account.is_autoreply_enabled)) state = 'ai_on';
  else state = 'ai_off';
  return {
    ok: missing.length === 0 && sessionOk,
    canEnableAi: promptOk && sessionOk,
    missing,
    state,
    labels: {
      online: !!online,
      prompt: promptOk,
      session: sessionOk,
      media: mediaLinkOk,
      ai: !!Number(account.is_autoreply_enabled),
    },
  };
}

/** #11 сжатый шаблон + поля имени/городов. Дни 1–2–3 NFT — в nftCampaign.js */
function loadPromptFile(fileName) {
  const candidates = [
    path.join(__dirname, '..', '..', 'prompts', fileName),
    path.join(__dirname, '..', 'prompts', fileName),
    path.join(process.cwd(), 'prompts', fileName),
    path.join(process.cwd(), '..', 'prompts', fileName),
  ];
  for (const f of candidates) {
    try {
      if (!fs.existsSync(f)) continue;
      const text = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').trim();
      if (text.length >= 120) return text;
    } catch (_) {}
  }
  return '';
}

function cityLower(s) {
  return String(s || '')
    .trim()
    .toLocaleLowerCase('ru-RU');
}

/** 21 год / 22–24 года / 25–30 лет */
function ageYearsWord(age) {
  const n = Math.abs(parseInt(age, 10)) || 0;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'год';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'года';
  return 'лет';
}

/** Подстановка {{NAME}} / {{FROM_CITY}} / {{TO_CITY}} / {{AGE}} (+ _LC / _IN / _ACC) */
function fillPersonaTemplate(template, fields = {}) {
  const name = String(fields.name || '').trim() || 'Аня';
  const age = String(fields.age || '').trim() || '26';
  const fromCity = String(fields.fromCity || '').trim() || 'Липецк';
  const toCity = String(fields.toCity || '').trim() || 'город';
  let inPrep = (s) => s;
  let inAcc = (s) => s;
  try {
    const pf = require('./personaFacts');
    inPrep = pf.inCityPrep || inPrep;
    inAcc = pf.inCityAcc || inAcc;
  } catch (_) {
    /* optional */
  }
  const fromIn = inPrep(fromCity);
  const toIn = inPrep(toCity);
  const fromAcc = inAcc(fromCity);
  const toAcc = inAcc(toCity);
  const ageWord = ageYearsWord(age);
  const map = {
    NAME: name,
    AGE: age,
    AGE_YEARS: `${age} ${ageWord}`,
    FROM_CITY: fromCity,
    TO_CITY: toCity,
    FROM_CITY_LC: cityLower(fromCity),
    TO_CITY_LC: cityLower(toCity),
    FROM_CITY_IN: fromIn,
    TO_CITY_IN: toIn,
    FROM_CITY_ACC: fromAcc,
    TO_CITY_ACC: toAcc,
    FROM_CITY_IN_LC: cityLower(fromIn),
    TO_CITY_IN_LC: cityLower(toIn),
    TO_CITY_ACC_LC: cityLower(toAcc),
  };
  return String(template || '').replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_, key) =>
    map[key] != null ? map[key] : '',
  );
}

function buildPersonaTemplates() {
  const slim = loadPromptFile('persona_slim.txt');
  if (!slim) {
    console.warn('[scaleOps] нет prompts/persona_slim.txt');
  }
  const defs = [
    {
      id: 'vika_timashevsk',
      title: 'Вика · Тимашевск',
      defaults: { name: 'Вика', age: '26', fromCity: 'Липецк', toCity: 'Тимашевск' },
    },
    {
      id: 'alena_ivanovo',
      title: 'Алёна · Иваново',
      defaults: { name: 'Алёна', age: '26', fromCity: 'Липецк', toCity: 'Иваново' },
    },
    {
      id: 'alina_kursk',
      title: 'Алина · Курск',
      defaults: { name: 'Алина', age: '26', fromCity: 'Липецк', toCity: 'Курск' },
    },
    {
      id: 'masha_krasnoyarsk',
      title: 'Маша · Красноярск',
      defaults: { name: 'Маша', age: '24', fromCity: 'Липецк', toCity: 'Красноярск' },
    },
    {
      id: 'nastya_veliky_novgorod',
      title: 'Настя · Великий Новгород',
      defaults: { name: 'Настя', age: '26', fromCity: 'Липецк', toCity: 'Великий Новгород' },
    },
    {
      id: 'anya_kazan',
      title: 'Аня · Казань',
      defaults: { name: 'Аня', age: '25', fromCity: 'Липецк', toCity: 'Казань' },
    },
    {
      id: 'sasha_samara',
      title: 'Саша · Самара',
      defaults: { name: 'Саша', age: '24', fromCity: 'Липецк', toCity: 'Самара' },
    },
    {
      id: 'alina_khimki',
      title: 'Алина · Химки',
      defaults: { name: 'Алина', age: '24', fromCity: 'Липецк', toCity: 'Химки' },
    },
  ];
  return defs.map((d) => {
    const prompt = fillPersonaTemplate(slim, d.defaults);
    return {
      id: d.id,
      title: d.title,
      defaults: d.defaults,
      template: slim,
      prompt,
      chars: prompt.length,
    };
  });
}

const PERSONA_TEMPLATES = buildPersonaTemplates();

/** #6 задачи */
async function enqueueTask({ accountId = null, peerId = null, kind, title, dueAt = null }) {
  await ensureTables();
  const [r] = await db.execute(
    `INSERT INTO worker_tasks (account_id, peer_id, kind, title, status, due_at)
     VALUES (?, ?, ?, ?, 'open', ?)`,
    [accountId, peerId, String(kind).slice(0, 40), String(title).slice(0, 250), dueAt],
  );
  return r.insertId;
}

async function listOpenTasks(limit = 40) {
  await ensureTables();
  const [rows] = await db.execute(
    `SELECT id, account_id, peer_id, kind, title, status, due_at, created_at
     FROM worker_tasks WHERE status = 'open'
     ORDER BY COALESCE(due_at, created_at) ASC LIMIT ?`,
    [Math.min(100, Math.max(1, limit))],
  );
  return rows;
}

async function closeTask(id) {
  await ensureTables();
  await db.execute(
    `UPDATE worker_tasks SET status = 'done', closed_at = NOW() WHERE id = ?`,
    [id],
  );
}

/** «с концами / навсегда» — про окончательность, не про срок. */
function isPermanenceMoveAsk(userMessage) {
  const u = String(userMessage || '');
  return /(?:с\s+концами|навсегда|окончательно|совсем\s+(?:уезж|переез)|переезжа(?:ешь|ете).{0,12}(?:да|что ли)\s*\?)/i.test(
    u,
  );
}

/** #22 мимо темы переезд */
function fixOfftopicMoveReply(reply, userMessage) {
  const u = String(userMessage || '');
  const r = String(reply || '').trim();
  if (!r) return reply;

  // «Ты с концами переезжаешь?» → да/к маме, НЕ «через пару недель уеду)»
  if (isPermanenceMoveAsk(u)) {
    if (/(?:с\s+концами|навсегда|окончательно|совсем|к\s+маме|да[,)]|ну да)/i.test(r)) {
      // если вместо ответа про окончательность впихнули только срок — чиним
      if (/пару\s+недел|на\s+днях|через\s+\d/i.test(r) && !/(?:с\s+концами|навсегда|к\s+маме|совсем)/i.test(r)) {
        const alts = ['ну да, к маме)', 'ага, совсем)', 'да, переезжаю окончательно)'];
        return alts[Math.floor(Math.random() * alts.length)];
      }
      return reply;
    }
    const alts = ['ну да, к маме)', 'ага, совсем)', 'да, переезжаю окончательно)'];
    return alts[Math.floor(Math.random() * alts.length)];
  }

  const askMove =
    /(?:когда|скоро|уже).{0,24}(?:переезд|уедешь|переезжа|съезжа)|когда\s+в\s+\w+/i.test(u);
  if (!askMove) return reply;
  if (/(?:переез|уед|пару\s+недел|через\s+\d|маме|анап|тимашев|курск|иванов)/i.test(r)) {
    return reply;
  }
  // явный мимо: сериал/дома сижу без переезда
  if (/(?:сериал|дома сижу|фоном|просто отдыха)/i.test(r) || r.length < 40) {
    const alts = ['через пару недель уже)', 'скоро, через пару недель)', 'через пару недель уеду)'];
    return alts[Math.floor(Math.random() * alts.length)];
  }
  // «на днях» про переезд — слишком близко, воркеры просят «пару недель»
  if (/на\s+днях/i.test(r) && /(?:переез|уед|съезж|к\s+маме)/i.test(u + ' ' + r)) {
    return r.replace(/на\s+днях/gi, 'через пару недель');
  }
  return reply;
}

/** Постфильтр: переезд/к маме не «на днях», а «через пару недель». */
function softenMoveTiming(reply, userMessage) {
  const text = String(reply || '');
  if (!text) return reply;
  const u = String(userMessage || '');
  // на вопрос «с концами» срок не подставляем
  if (isPermanenceMoveAsk(u) && /пару\s+недел|на\s+днях/i.test(text) && !/(?:с\s+концами|навсегда|к\s+маме)/i.test(text)) {
    const alts = ['ну да, к маме)', 'ага, совсем)', 'да, переезжаю окончательно)'];
    return alts[Math.floor(Math.random() * alts.length)];
  }
  if (!/на\s+днях/i.test(text)) return reply;
  const aboutMove =
    /(?:переез|уед|съезж|когда\s+в\s+|к\s+маме|на\s+днях)/i.test(u) ||
    /(?:переез|уед|съезж|к\s+маме|скоро\s+буду|уеду)/i.test(text);
  if (!aboutMove) return reply;
  return text.replace(/на\s+днях/gi, 'через пару недель');
}

/** #18 анти-эхо коротких кивков */
function breakShortAckEcho(reply, history) {
  const body = String(reply || '').trim();
  if (!/^(?:ну\s+)?(?:да\s+)?(?:ага|угу|ок|окей|ладно|поняла?|ну да)\s*\)?\.?$/i.test(body)) {
    return reply;
  }
  const recent = (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-5)
    .map((m) => String(m.content || '').trim());
  const same = recent.filter((c) => /^(?:ну\s+)?(?:да\s+)?(?:ага|угу|ок|ладно|поняла?|ну да)\s*\)?\.?$/i.test(c))
    .length;
  if (same < 1) return reply;
  const alts = ['хм, ясно)', 'мм, я тут)', 'поняла тебя)', 'слышу)', 'ну смотри)'];
  return alts[Math.floor(Math.random() * alts.length)];
}

module.exports = {
  ensureTables,
  activateInWaves,
  persistBusy,
  clearBusy,
  clearBusyForAccount,
  restoreBusyFromDb,
  pickBusyDelayMs,
  accountHourLoad,
  loadThrottleState,
  noteBurstReply,
  burstExtraDelayMs,
  getPoolRoleCounts,
  checklistForAccount,
  PERSONA_TEMPLATES,
  fillPersonaTemplate,
  enqueueTask,
  listOpenTasks,
  closeTask,
  fixOfftopicMoveReply,
  softenMoveTiming,
  isPermanenceMoveAsk,
  breakShortAckEcho,
  BOOT_WAVE_SIZE,
  BOOT_WAVE_MS,
  LOAD_SOFT_PER_HOUR,
  LOAD_HARD_PER_HOUR,
  LOGIN_MIN,
  MIN_PROXY_LEN,
};
