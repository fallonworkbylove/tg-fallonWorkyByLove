/**
 * scaleIdeasPack (0m1) — выбранный пакет идей:
 * 1 loop · 5 mood echo · 6 typing · 7 soft meet · 10 toxic soft ·
 * 13 single NFT voice · 16 day-N · 17 hot lead · 24/31 account card/health ·
 * 25 admin errors · 32 proxy rotate · 34 city TZ · 36 pools ·
 * 38 compare · 39 CSV · 40 proxy push · 46 bot-score · 48 smoke checklist ·
 * 50 idea-of-day (creator fallonsociapat).
 */
const fs = require('fs');
const path = require('path');

function getDb() {
  return require('../db');
}

const CREATOR_USERNAME = String(process.env.CREATOR_USERNAME || 'fallonsociapat')
  .trim()
  .replace(/^@+/, '')
  .toLowerCase();

const NFT_VOICE_FILE = 'nft.ogg';
const TOPIC_BUCKETS = [
  { id: 'work', re: /работ|офис|смен|начальник|зарплат/i },
  { id: 'weather', re: /погод|дожд|снег|холод|жарк/i },
  { id: 'food', re: /еда|ужин|обед|кофе|чай|пицц/i },
  { id: 'move', re: /переезд|коробк|сбор|квартир/i },
  { id: 'nft', re: /nft|нфт|токен|флип|крипт/i },
  { id: 'meet', re: /встрет|погуля|кофе\s+вместе|свидан/i },
  { id: 'mood', re: /настроен|как\s+ты|скуч|устал/i },
];

const SOFT_MEET_ALTS = [
  'ой я бы с радостью, но сейчас в разъездах) давай пока тут)',
  'после переезда точно, а пока только переписка ок?)',
  'сейчас сложно выбраться, давай пока тут поболтаем)',
  'не обещаю встречу скоро — после переезда ок?)',
];

const TOXIC_SOFT_ALTS = [
  'эй полегче) я без зла',
  'давай без агрессии, мне так спокойнее)',
  'мне неприятно так, давай нормально)',
  'ок, сделаем паузу если бесит)',
];

const TOPIC_SHIFT_ALTS = [
  'кстати а ты как день вообще?)',
  'ладно, смена темы) че у тебя нового?',
  'ой зациклились) расскажи лучше про себя)',
  'хм, давай про другое) чем занят?',
];

const MOOD_ECHO = {
  warm: { hint: 'Он тёплый/мягкий — ответь тепло, коротко, без холодной сухости.', mul: 1.05 },
  dry: { hint: 'Он сухой/короткий — отвечай коротко и по делу, без воды.', mul: 0.85 },
  tense: { hint: 'Он напряжён/резкий — мягко, без оправданий и без эскалации.', mul: 1.15 },
  playful: { hint: 'Он шутит/лёгкий — можно лёгкий тон, без переигрыша.', mul: 0.95 },
  neutral: { hint: '', mul: 1 },
};

const CITY_TZ_OFFSET_MIN = {
  калининград: -60,
  москва: 0,
  питер: 0,
  спб: 0,
  'санкт-петербург': 0,
  нижегород: 0,
  новгород: 0,
  казань: 0,
  самар: 60,
  екатеринбург: 120,
  челябинск: 120,
  новосибирск: 180,
  красноярск: 240,
  иркутск: 300,
  владивосток: 420,
  анапа: 0,
  краснодар: 0,
  сочи: 0,
};

const BOT_CLICHE_RE =
  /(?:как\s+ИИ|я\s+всего\s+лишь|безусловно|разумеется|в\s+заключени|подвед[её]м\s+итог|важно\s+отметить|конечно(?:\s+же)?[,!]?\s+я\s+понимаю)/i;
const ROBOT_MARKERS_RE =
  /(?:^|\n)\s*(?:1\)|2\)|•|—\s+[А-ЯЁ])/m;

let schemaReady = false;
const proxyFailCounts = new Map();
let lastProxyPushAt = 0;

function stripTag(reply) {
  const m = String(reply || '').match(/^(\s*<<[^>\n]+>>\s*)/);
  return { tag: m ? m[1] : '', body: m ? String(reply).slice(m[1].length) : String(reply || '') };
}

function pickAlt(arr) {
  const list = Array.isArray(arr) ? arr.filter(Boolean) : [];
  if (!list.length) return '';
  return list[Math.floor(Math.random() * list.length)];
}

function topicOf(text) {
  const t = String(text || '');
  for (const b of TOPIC_BUCKETS) {
    if (b.re.test(t)) return b.id;
  }
  const norm = t
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  return norm || 'other';
}

/** #1: 3 одинаковых темы подряд у ассистента → смена. */
function detectTopicLoop(history) {
  const asst = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'assistant')
    .slice(-6)
    .map((h) => topicOf(h.content));
  if (asst.length < 3) return { looping: false, topic: null };
  const last3 = asst.slice(-3);
  if (last3[0] && last3[0] === last3[1] && last3[1] === last3[2] && last3[0] !== 'other') {
    return { looping: true, topic: last3[0] };
  }
  return { looping: false, topic: last3[last3.length - 1] || null };
}

function fixTopicLoopReply(reply, history) {
  if (!reply) return reply;
  const det = detectTopicLoop(history);
  if (!det.looping) return reply;
  const { tag, body } = stripTag(reply);
  if (!body) return reply;
  if (topicOf(body) !== det.topic) return reply;
  return tag + pickAlt(TOPIC_SHIFT_ALTS);
}

function topicLoopHint(history) {
  const det = detectTopicLoop(history);
  if (!det.looping) return '';
  return `Вы зациклились на теме «${det.topic}». Смени угол: короткий вопрос про него, без той же темы.`;
}

/** #5 mood echo */
function detectMoodEcho(userMessage) {
  const t = String(userMessage || '');
  if (!t.trim()) return 'neutral';
  if (/(?:ахах|хаха|лол|😂|😄|прикол|смешн)/i.test(t)) return 'playful';
  if (/(?:дур[ае]|идиот|заткн|ненавиж|пош[её]л|отстан|бесит|твар)/i.test(t)) return 'tense';
  if (t.length <= 12 && !/[?]/.test(t)) return 'dry';
  if (/(?:мила|хорош|люблю|скучаю|обня|тепл|спасибо|благодар)/i.test(t)) return 'warm';
  if (/[!]{2,}|\?{2,}/.test(t)) return 'tense';
  return 'neutral';
}

function moodEchoHint(userMessage) {
  const key = detectMoodEcho(userMessage);
  return { key, ...(MOOD_ECHO[key] || MOOD_ECHO.neutral) };
}

/** #6 typing multiplier by mood + length already in humanRhythm */
function typingMoodMul(userMessage) {
  return moodEchoHint(userMessage).mul || 1;
}

/** #7 soft meet refuse bank */
function isMeetAsk(text) {
  try {
    return require('./objectionHandler').isMeetRequest(text);
  } catch (_) {
    return /встрет|погуля|свидан|кофе\s+вместе/i.test(String(text || ''));
  }
}

function fixSoftMeetRefuse(reply, userMessage) {
  if (!reply || !isMeetAsk(userMessage)) return reply;
  const { tag, body } = stripTag(reply);
  if (!body) return reply;
  // Уже мягкий отказ — не трогаем.
  if (/(?:переезд|разъезд|пока\s+тут|после\s+переезд|не\s+обещ|сложно\s+выбр)/i.test(body)) {
    return reply;
  }
  // Согласие / план встречи → soft bank.
  if (
    /(?:давай\s+встрет|го\s+встрет|конечно\s+встрет|жду\s+тебя|приеду|приду|увидимся\s+завтра|давай\s+завтра)/i.test(
      body,
    ) ||
    /(?:да|го|конечно|давай|ок|хорошо|можно).{0,24}(?:встрет|погуля|кофе|свидан)/i.test(body) ||
    /(?:встрет|погуля|увидимся|приеду|приду)/i.test(body)
  ) {
    return tag + pickAlt(SOFT_MEET_ALTS);
  }
  return reply;
}

/** #10 toxic → soft friend mode */
function isToxicIncoming(text) {
  return /(?:дур[ае]|идиот|заткн|ненавиж|пош[её]л\s+нах|отстан|твар|сука|шлюх|убей|сдохн|мраз)/i.test(
    String(text || ''),
  );
}

function fixToxicSoftMode(reply, userMessage) {
  if (!reply || !isToxicIncoming(userMessage)) return reply;
  const { tag, body } = stripTag(reply);
  if (!body) return reply;
  if (/(?:эй\s+полегче|без\s+агресс|неприятно|паузу)/i.test(body)) return reply;
  return tag + pickAlt(TOXIC_SOFT_ALTS);
}

function toxicModeHint(userMessage) {
  if (!isToxicIncoming(userMessage)) return '';
  return 'Он токсичен/агрессивен. Режим «подруга в беде»: мягко, коротко, без воронки NFT и без оправданий. Можно предложить паузу.';
}

/** #46 bot-sound score 0–10 (10 = очень бот) */
function scoreBotSound(reply) {
  const body = stripTag(reply).body.trim();
  if (!body) return 0;
  let score = 0;
  if (body.length > 120) score += 2;
  if (body.length > 220) score += 1;
  if (BOT_CLICHE_RE.test(body)) score += 3;
  if (ROBOT_MARKERS_RE.test(body)) score += 2;
  if ((body.match(/[.!?]/g) || []).length >= 3) score += 1;
  if (/,\s*и\s*,\s*и\s+/i.test(body)) score += 1;
  const formalHits = (
    body.match(/(?:разумеется|безусловно|в целом|таким образом|важно отметить|подвед[её]м\s+итог)/gi) || []
  ).length;
  score += Math.min(4, formalHits);
  if (body.split(/\s+/).length <= 12 && !BOT_CLICHE_RE.test(body) && formalHits === 0) {
    score = Math.max(0, score - 2);
  }
  return Math.max(0, Math.min(10, score));
}

function fixBotSoundHeavy(reply) {
  if (!reply) return reply;
  const score = scoreBotSound(reply);
  if (score < 7) return reply;
  const { tag, body } = stripTag(reply);
  const cut = body.split(/(?<=[.!?…)])\s+/)[0] || body;
  const short = cut.length > 90 ? `${cut.slice(0, 87).trim()}…` : cut;
  return tag + short.replace(BOT_CLICHE_RE, '').trim();
}

/** Wave postfilters for applySoftLite */
function applyWave0m1Gates(reply, history, userMessage) {
  let out = reply;
  out = fixTopicLoopReply(out, history);
  out = fixSoftMeetRefuse(out, userMessage);
  out = fixToxicSoftMode(out, userMessage);
  out = fixBotSoundHeavy(out);
  return out;
}

function buildScaleHints(history, userMessage) {
  const parts = [];
  const loop = topicLoopHint(history);
  if (loop) parts.push(loop);
  const mood = moodEchoHint(userMessage);
  if (mood.hint) parts.push(mood.hint);
  const toxic = toxicModeHint(userMessage);
  if (toxic) parts.push(toxic);
  return { hints: parts, moodKey: mood.key, typingMul: mood.mul };
}

async function ensureSchema() {
  if (schemaReady) return;
  await getDb().execute(`
    CREATE TABLE IF NOT EXISTS account_pools (
      account_id INT NOT NULL PRIMARY KEY,
      pool_key VARCHAR(64) NOT NULL,
      owner_label VARCHAR(64) NULL,
      city VARCHAR(64) NULL,
      tz_offset_min INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_pool (pool_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await getDb().execute(`
    CREATE TABLE IF NOT EXISTS scale_idea_day (
      id INT AUTO_INCREMENT PRIMARY KEY,
      idea_text VARCHAR(255) NOT NULL,
      source VARCHAR(64) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  schemaReady = true;
}

/** #13 — одно голосовое NFT-кампании: только nft.ogg. */
function resolveNftVoiceFile(voicesDir) {
  const dir = voicesDir || path.join(__dirname, '..', 'voices');
  const file = NFT_VOICE_FILE;
  try {
    if (fs.existsSync(path.join(dir, file))) return file;
  } catch (_) {
    /* optional */
  }
  return file;
}

function nftVoiceStatus(voicesDir) {
  const file = resolveNftVoiceFile(voicesDir);
  const dir = voicesDir || path.join(__dirname, '..', 'voices');
  let exists = false;
  try {
    exists = fs.existsSync(path.join(dir, file));
  } catch (_) {
    exists = false;
  }
  return { file, exists, single: true };
}

/** #16 day-N funnel week */
async function getDayNFunnelWeek() {
  const [rows] = await getDb().execute(
    `SELECT
       SUM(funnel_stage IN ('day1','hello')) AS day1,
       SUM(funnel_stage IN ('day2','chat')) AS day2,
       SUM(funnel_stage IN ('day3','interest')) AS day3,
       SUM(funnel_stage IN ('day4','pitch','operator')) AS day4,
       SUM(funnel_stage = 'filtered') AS filtered,
       COUNT(*) AS total
     FROM operator_lead_flags
     WHERE updated_at >= (NOW() - INTERVAL 7 DAY)`,
  );
  const r = rows?.[0] || {};
  return {
    windowDays: 7,
    day1: Number(r.day1 || 0),
    day2: Number(r.day2 || 0),
    day3: Number(r.day3 || 0),
    day4: Number(r.day4 || 0),
    filtered: Number(r.filtered || 0),
    total: Number(r.total || 0),
  };
}

/** #17 hot lead manual touch — text helper */
function formatHotLeadAlert({ accountName, phone, peerName, reason }) {
  return (
    `<b>Ручное касание</b>\n` +
    `Лид готов (${String(reason || 'ready')}).\n` +
    `Акк: <b>${accountName || '—'}</b>${phone ? ` · ${phone}` : ''}\n` +
    `Пир: ${peerName || '—'}`
  );
}

/** #31 health score */
async function computeAccountHealth(accountId) {
  const id = Number(accountId);
  let online = false;
  let ai = false;
  let phone = null;
  let owner = null;
  let lastReplyAgeMin = null;
  let proxyLabel = null;
  let queueDepth = 0;
  let floodish = false;

  try {
    const [[acc]] = await getDb().execute(
      `SELECT a.phone, a.is_autoreply_enabled AS ai, u.username AS owner
       FROM accounts a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.id = ? LIMIT 1`,
      [id],
    );
    phone = acc?.phone || null;
    ai = Boolean(Number(acc?.ai));
    owner = acc?.owner ? `@${acc.owner}` : null;
  } catch (_) {
    /* optional */
  }
  try {
    online = require('./clientPool').isActive(id);
  } catch (_) {
    /* optional */
  }
  try {
    const [[lr]] = await getDb().execute(
      `SELECT TIMESTAMPDIFF(MINUTE, MAX(created_at), NOW()) AS age
       FROM conversation_messages
       WHERE account_id = ? AND role = 'assistant'`,
      [id],
    );
    lastReplyAgeMin = lr?.age != null ? Number(lr.age) : null;
  } catch (_) {
    /* optional */
  }
  try {
    const { getMessageBuffers } = require('./inbound');
    // buffers keyed — approximate via processing set size if exposed
  } catch (_) {
    /* optional */
  }
  try {
    const so = require('./scaleOps');
    if (typeof so.countBusyForAccount === 'function') {
      queueDepth = Number(await so.countBusyForAccount(id)) || 0;
    }
  } catch (_) {
    /* optional */
  }
  try {
    const [[burst]] = await getDb().execute(
      `SELECT COUNT(*) AS n FROM conversation_messages
       WHERE account_id = ? AND role = 'assistant'
         AND created_at >= (NOW() - INTERVAL 10 MINUTE)`,
      [id],
    );
    floodish = Number(burst?.n || 0) > 25;
  } catch (_) {
    /* optional */
  }

  let score = 40;
  if (online) score += 25;
  if (ai) score += 15;
  if (lastReplyAgeMin != null && lastReplyAgeMin <= 30) score += 15;
  else if (lastReplyAgeMin != null && lastReplyAgeMin <= 120) score += 8;
  else if (lastReplyAgeMin != null && lastReplyAgeMin > 360) score -= 10;
  if (queueDepth > 5) score -= 8;
  if (floodish) score -= 15;
  score = Math.max(0, Math.min(100, score));

  return {
    accountId: id,
    phone,
    owner,
    online,
    ai,
    lastReplyAgeMin,
    proxyLabel,
    queueDepth,
    floodish,
    health: score,
  };
}

/** #32 proxy fail rotate */
function noteProxyFail(key, { threshold = 3, onRotate } = {}) {
  const k = String(key || 'default');
  const n = (proxyFailCounts.get(k) || 0) + 1;
  proxyFailCounts.set(k, n);
  if (n < threshold) return { rotated: false, fails: n };
  proxyFailCounts.set(k, 0);
  try {
    if (typeof onRotate === 'function') onRotate(k, n);
    else {
      const pools = require('./proxyPools');
      if (typeof pools.markProxyDeadByHost === 'function') {
        const m = k.match(/^([^:]+):(\d+)/);
        if (m) pools.markProxyDeadByHost(m[1], Number(m[2]), `failx${n}`);
      }
    }
  } catch (_) {
    /* optional */
  }
  return { rotated: true, fails: n };
}

function noteProxyOk(key) {
  proxyFailCounts.set(String(key || 'default'), 0);
}

/** #34 city TZ from prompt */
function detectCityFromPrompt(prompt) {
  const p = String(prompt || '').toLowerCase();
  for (const city of Object.keys(CITY_TZ_OFFSET_MIN)) {
    if (p.includes(city)) return city;
  }
  const m = p.match(/(?:живу\s+в|из\s+|город[еу]?\s+)([а-яё\-]{3,20})/i);
  if (m) return m[1].toLowerCase();
  return null;
}

function cityTzOffsetMin(promptOrCity) {
  const city = detectCityFromPrompt(promptOrCity) || String(promptOrCity || '').toLowerCase();
  if (!city) return 0;
  for (const [k, off] of Object.entries(CITY_TZ_OFFSET_MIN)) {
    if (city.includes(k) || k.includes(city)) return off;
  }
  return 0;
}

function shiftLifeByCityTz(life, prompt) {
  if (!life) return life;
  const off = cityTzOffsetMin(prompt);
  if (!off) return { ...life, tzOffsetMin: 0, city: detectCityFromPrompt(prompt) };
  return {
    ...life,
    wakeMin: life.wakeMin - off,
    sleepMin: life.sleepMin - off,
    afternoonMin: life.afternoonMin != null ? life.afternoonMin - off : life.afternoonMin,
    eveningMin: life.eveningMin != null ? life.eveningMin - off : life.eveningMin,
    tzOffsetMin: off,
    city: detectCityFromPrompt(prompt),
  };
}

/** #36 pools */
async function setAccountPool(accountId, { poolKey, ownerLabel, city } = {}) {
  await ensureSchema();
  const tz = cityTzOffsetMin(city || '');
  await getDb().execute(
    `INSERT INTO account_pools (account_id, pool_key, owner_label, city, tz_offset_min)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       pool_key = VALUES(pool_key),
       owner_label = VALUES(owner_label),
       city = VALUES(city),
       tz_offset_min = VALUES(tz_offset_min)`,
    [
      Number(accountId),
      String(poolKey || 'default').slice(0, 64),
      ownerLabel ? String(ownerLabel).slice(0, 64) : null,
      city ? String(city).slice(0, 64) : null,
      tz,
    ],
  );
}

async function listAccountPools() {
  await ensureSchema();
  const [rows] = await getDb().execute(
    `SELECT p.pool_key, p.owner_label, COUNT(*) AS n,
            GROUP_CONCAT(p.account_id ORDER BY p.account_id SEPARATOR ',') AS ids
     FROM account_pools p
     GROUP BY p.pool_key, p.owner_label
     ORDER BY n DESC, p.pool_key`,
  );
  return rows || [];
}

/** #38 compare accounts */
async function compareAccounts(idA, idB) {
  const [a, b] = await Promise.all([
    computeAccountHealth(idA),
    computeAccountHealth(idB),
  ]);
  const loadSide = async (id) => {
    const [[row]] = await getDb().execute(
      `SELECT
         (SELECT COUNT(*) FROM conversation_messages m
           WHERE m.account_id = ? AND m.role = 'assistant'
             AND m.created_at >= (NOW() - INTERVAL 7 DAY)) AS sent7,
         (SELECT COUNT(*) FROM operator_lead_flags f
           WHERE f.account_id = ? AND f.funnel_stage IN ('day3','day4','pitch','operator')) AS hot,
         (SELECT COUNT(*) FROM operator_lead_flags f
           WHERE f.account_id = ? AND f.funnel_stage = 'filtered') AS filtered
      `,
      [id, id, id],
    );
    return {
      sent7: Number(row?.sent7 || 0),
      hot: Number(row?.hot || 0),
      filtered: Number(row?.filtered || 0),
    };
  };
  const [sa, sb] = await Promise.all([loadSide(Number(idA)), loadSide(Number(idB))]);
  return {
    a: { ...a, ...sa },
    b: { ...b, ...sb },
    delta: {
      health: a.health - b.health,
      sent7: sa.sent7 - sb.sent7,
      hot: sa.hot - sb.hot,
      filtered: sa.filtered - sb.filtered,
    },
  };
}

/** #39 metrics CSV */
async function buildMetricsCsvDay() {
  const dayN = await getDayNFunnelWeek();
  const voice = nftVoiceStatus();
  const lines = ['metric,value'];
  lines.push(`day1,${dayN.day1}`);
  lines.push(`day2,${dayN.day2}`);
  lines.push(`day3,${dayN.day3}`);
  lines.push(`day4,${dayN.day4}`);
  lines.push(`filtered,${dayN.filtered}`);
  lines.push(`nft_voice_file,${voice.file}`);
  lines.push(`nft_voice_exists,${voice.exists ? 1 : 0}`);
  try {
    const live = await require('./opsLiveMetrics').getLiveMetrics();
    lines.push(`replies_per_hour,${Number(live?.repliesPerHour || 0)}`);
    lines.push(`proxy_len,${Number(live?.health?.proxyLen || 0)}`);
  } catch (_) {
    /* optional */
  }
  return `${lines.join('\n')}\n`;
}

/** #25 admin error feed */
function getAdminErrorFeed(limit = 40) {
  try {
    const buf = require('./adminLogBuffer');
    const pack = typeof buf.getLogs === 'function' ? buf.getLogs({ limit: 200 }) : { lines: [] };
    const rows = Array.isArray(pack?.lines) ? pack.lines : [];
    return rows
      .filter((l) => {
        const lvl = String(l.level || l.lvl || '').toLowerCase();
        const text = String(l.text || l.message || '');
        return (
          lvl === 'error' ||
          lvl === 'warn' ||
          /OPENAI|REFUSE_PROXY|SocksClient|PEER_ID|FROZEN|failover|DEAD/i.test(text)
        );
      })
      .slice(-Math.max(1, Math.min(100, Number(limit) || 40)))
      .reverse();
  } catch (_) {
    return [];
  }
}

/** #40 proxy low → admin alert + stamp for Android OPS */
async function maybePushProxyLow(proxyLen, { min = 5 } = {}) {
  const n = Number(proxyLen);
  if (!Number.isFinite(n) || n >= min) return { pushed: false };
  const now = Date.now();
  if (now - lastProxyPushAt < 15 * 60 * 1000) return { pushed: false, throttled: true };
  lastProxyPushAt = now;
  const payload = {
    type: 'proxy_low',
    proxyLen: n,
    min,
    at: new Date().toISOString(),
    forAndroid: true,
  };
  try {
    const stamp = path.join(__dirname, '..', 'tmp_proxy_low_alert.json');
    fs.writeFileSync(stamp, JSON.stringify(payload, null, 2));
  } catch (_) {
    /* optional */
  }
  try {
    const { sendAdminAlert } = require('./helpRequestNotifier');
    await sendAdminAlert(
      `<b>PROXY низкий</b>\nСейчас: <b>${n}</b> (нужно ≥${min}).\nПроверь пул — Android OPS / админка.`,
    );
  } catch (_) {
    /* optional */
  }
  return { pushed: true, ...payload };
}

/** #48 changelog → smoke checklist */
function buildChangelogSmokeChecklist(changelogText, { limit = 8 } = {}) {
  const text = String(changelogText || '');
  const tags = [];
  const re = /^##\s+(0[a-z0-9]+)\./gim;
  let m;
  while ((m = re.exec(text)) && tags.length < limit) {
    tags.push(m[1]);
  }
  const scriptsDir = path.join(__dirname, '..', 'scripts');
  return tags.map((tag) => {
    const smoke = `_smoke_wave_${tag}.js`;
    const alt = fs
      .readdirSync(scriptsDir)
      .filter((f) => f.includes(tag) && f.startsWith('_smoke_'))
      .slice(0, 3);
    const preferred = fs.existsSync(path.join(scriptsDir, smoke)) ? smoke : alt[0] || null;
    return {
      tag,
      smoke: preferred,
      exists: Boolean(preferred && fs.existsSync(path.join(scriptsDir, preferred))),
    };
  });
}

/** #50 idea of the day for creator */
function isCreatorUser(username, telegramUserId) {
  const u = String(username || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
  if (u && u === CREATOR_USERNAME) return true;
  const creatorId = String(process.env.CREATOR_TELEGRAM_ID || '').trim();
  if (creatorId && String(telegramUserId || '') === creatorId) return true;
  return false;
}

async function getIdeaOfDay() {
  await ensureSchema();
  const ideas = [];
  try {
    const notesPath = path.join(__dirname, '..', '..', 'notes_live_bugs.md');
    if (fs.existsSync(notesPath)) {
      const lines = fs
        .readFileSync(notesPath, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
        .filter((l) => l.length > 12 && l.length < 180 && !/^#/.test(l));
      for (const line of lines.slice(0, 20)) {
        ideas.push({ text: line, source: 'live_bugs' });
      }
    }
  } catch (_) {
    /* optional */
  }
  try {
    const auditPath = path.join(__dirname, '..', '..', 'audit_bugs.txt');
    if (fs.existsSync(auditPath)) {
      const lines = fs
        .readFileSync(auditPath, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 12 && l.length < 180);
      for (const line of lines.slice(0, 10)) {
        ideas.push({ text: line, source: 'audit' });
      }
    }
  } catch (_) {
    /* optional */
  }
  // fallback curated
  if (!ideas.length) {
    ideas.push(
      { text: 'Анти-цикл тем после 3 одинаковых ходов', source: 'pack' },
      { text: 'Радар day1–day4 и лента ошибок в админке', source: 'pack' },
      { text: 'Health-score аккаунтов на карточке админки', source: 'pack' },
    );
  }
  // stable pick by day
  const day = new Date().toISOString().slice(0, 10);
  let hash = 0;
  for (let i = 0; i < day.length; i += 1) hash = (hash * 31 + day.charCodeAt(i)) % 9973;
  const start = hash % ideas.length;
  const top = [];
  for (let i = 0; i < Math.min(3, ideas.length); i += 1) {
    top.push(ideas[(start + i) % ideas.length]);
  }
  return { date: day, for: CREATOR_USERNAME, ideas: top };
}

module.exports = {
  CREATOR_USERNAME,
  NFT_VOICE_FILE,
  detectTopicLoop,
  fixTopicLoopReply,
  topicLoopHint,
  detectMoodEcho,
  moodEchoHint,
  typingMoodMul,
  isMeetAsk,
  fixSoftMeetRefuse,
  isToxicIncoming,
  fixToxicSoftMode,
  toxicModeHint,
  scoreBotSound,
  fixBotSoundHeavy,
  applyWave0m1Gates,
  buildScaleHints,
  ensureSchema,
  resolveNftVoiceFile,
  nftVoiceStatus,
  getDayNFunnelWeek,
  formatHotLeadAlert,
  computeAccountHealth,
  noteProxyFail,
  noteProxyOk,
  detectCityFromPrompt,
  cityTzOffsetMin,
  shiftLifeByCityTz,
  setAccountPool,
  listAccountPools,
  compareAccounts,
  buildMetricsCsvDay,
  getAdminErrorFeed,
  maybePushProxyLow,
  buildChangelogSmokeChecklist,
  isCreatorUser,
  getIdeaOfDay,
};
