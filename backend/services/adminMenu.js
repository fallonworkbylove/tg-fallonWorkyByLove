/**
 * Админ-меню в боте-уведомителе (BOT_TOKEN). Доступно суперадмину
 * ADMIN_ALERT_CHAT_ID и операторам с ролью admin из /menu → Доступ.
 */

const { exec } = require('child_process');
const OpenAI = require('openai');
const { SocksClient } = require('socks');
const db = require('../db');
const opsAdmin = require('./opsAdmin');
const operatorAccess = require('./operatorAccess');
const { ensureAccountSeqSchema } = require('./accountCleanup');

const ADMIN_CHAT_ID = String(process.env.ADMIN_ALERT_CHAT_ID || '8588744561');
const PING_MODEL = 'gpt-4o-mini';
const BILLING_URL = 'https://platform.openai.com/settings/organization/billing';
const TG_PROBE_HOST = '149.154.167.50';
const TG_PROBE_PORT = 443;
const PROXY_PROBE_TIMEOUT_MS = 8000;
/** Быстрая проверка из /menu — короткий таймаут, всё параллельно. */
const QUICK_PROBE_TIMEOUT_MS = 2500;

function menuKeyboard(chatId) {
  const rows = [
    [
      { text: '📲 Подключить', callback_data: 'wrk:connect' },
      { text: '🗑 Мои номера', callback_data: 'wrk:my' },
    ],
    [{ text: '🔔 Уведомления о лидах', callback_data: 'wrk:ntf' }],
    [
      { text: '📱 Аккаунты', callback_data: 'adm:accounts' },
      { text: '📊 Статистика', callback_data: 'adm:stats' },
    ],
    [
      { text: '💳 OpenAI', callback_data: 'adm:openai' },
      { text: '🛠 Система', callback_data: 'adm:system' },
    ],
  ];
  if (operatorAccess.isSuperAdmin(chatId)) {
    rows.push([{ text: '👥 Доступ', callback_data: 'adm:ops' }]);
  }
  rows.push([{ text: '⚡ Быстрая проверка', callback_data: 'adm:check' }]);
  rows.push(
    [
      { text: '🚫 Чёрный список', callback_data: 'adm:bl' },
      { text: '🔄 Обновить', callback_data: 'adm:menu' },
    ],
  );
  return { inline_keyboard: rows };
}

/** Живая шапка /menu: онлайн · AI · горячие · сообщения сегодня. */
async function buildMenuHomeText() {
  let online = 0;
  let total = 0;
  let aiOn = 0;
  let hot = 0;
  let sentToday = 0;

  try {
    const tc = require('./telegramClient');
    const [rows] = await db.execute(
      `SELECT a.id, a.is_autoreply_enabled AS ai
       FROM accounts a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE COALESCE(u.is_blocked, 0) = 0`,
    );
    total = rows.length;
    aiOn = rows.filter((r) => Number(r.ai)).length;
    online = rows.filter((r) => {
      try {
        return tc.isActive(r.id);
      } catch (_) {
        return false;
      }
    }).length;
  } catch (_) {}

  try {
    const [[h]] = await db.execute(
      `SELECT COUNT(*) AS c FROM operator_lead_flags
       WHERE funnel_stage IN ('interest', 'pitch', 'operator')`,
    );
    hot = Number(h?.c || 0);
  } catch (_) {}

  try {
    const dayStart = sqlMskDayStart(0);
    const [[m]] = await db.execute(
      `SELECT SUM(role = 'assistant') AS sent
       FROM conversation_messages
       WHERE created_at >= ${dayStart}`,
    );
    sentToday = Number(m?.sent || 0);
  } catch (_) {}

  const live = total
    ? `${online} онлайн · AI ${aiOn}/${total}` + (hot > 0 ? ` · ${hot} горячих` : '')
    : 'нет аккаунтов';

  return (
    '<b>Админ-меню</b>\n' +
    `<code>${esc(live)}</code>\n` +
    `Сегодня отправлено: <b>${num(sentToday)}</b>\n\n` +
    'Выбери раздел:'
  );
}

function sectionKeyboard(refreshData) {
  return {
    inline_keyboard: [[
      { text: '🔄 Обновить', callback_data: refreshData },
      { text: '« Меню', callback_data: 'adm:menu' },
    ]],
  };
}

function systemKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🔄 Обновить', callback_data: 'adm:system' },
        { text: '« Меню', callback_data: 'adm:menu' },
      ],
      [{ text: '⚡ Быстрая проверка', callback_data: 'adm:check' }],
      [{ text: '♻️ Перезапустить бота', callback_data: 'adm:restart' }],
    ],
  };
}

function checkKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🔄 Ещё раз', callback_data: 'adm:check' },
        { text: '🛠 Подробнее', callback_data: 'adm:system' },
      ],
      [{ text: '« Меню', callback_data: 'adm:menu' }],
    ],
  };
}

function isAdminChat(chatId) {
  return operatorAccess.isAdminSync(chatId);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function num(n) {
  return Number(n || 0).toLocaleString('ru-RU');
}

function usd(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

async function tg(api, method, payload) {
  const res = await fetch(`${api}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok && !/message is not modified/.test(String(body.description || ''))) {
    console.error(`[adminMenu] ${method} не удался:`, body.description || res.status);
  }
  return body;
}

// ---------------------------------------------------------------------------
// РАЗДЕЛЫ
// ---------------------------------------------------------------------------

function accountDisplayName(accountId) {
  try {
    const label = String(require('./telegramClient').accountLabel(accountId) || '');
    const parts = label.split(' — ');
    return parts.length > 1 ? parts.slice(1).join(' — ') : null;
  } catch (_) {
    return null;
  }
}

function accountOnline(accountId) {
  try {
    return require('./telegramClient').isActive(accountId);
  } catch (_) {
    return false;
  }
}

/**
 * Начало календарных суток по Москве (UTC+3) в UTC-времени MySQL.
 * daysAgo=0 → сегодня 00:00 МСК; daysAgo=6 → начало окна «7 календарных дней».
 * Сервер в UTC: в 00:00 МСК счётчики «сегодня» обнуляются.
 */
function sqlMskDayStart(daysAgo = 0) {
  const d = Math.max(0, Number(daysAgo) || 0);
  return (
    `DATE_ADD(DATE_ADD(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR)), ` +
    `INTERVAL -${d} DAY), INTERVAL -3 HOUR)`
  );
}

async function buildAccountsText() {
  try {
    await ensureAccountSeqSchema();
  } catch (_) {}
  const dayStart = sqlMskDayStart(0);
  const [rows] = await db.execute(
    `SELECT a.id, a.seq, a.phone, a.is_autoreply_enabled AS ai,
            u.username, u.first_name, u.telegram_user_id,
            (SELECT COUNT(*) FROM conversation_messages m
              WHERE m.account_id = a.id AND m.role = 'assistant'
                AND m.created_at >= ${dayStart}) AS sent_today
     FROM accounts a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE COALESCE(u.is_blocked, 0) = 0
     ORDER BY u.username, COALESCE(a.seq, a.id), a.id`,
  );
  if (!rows.length) {
    return (
      '<b>📱 Аккаунты в боте</b>\n\nНи одного подключённого номера.\n\n' +
      '<i>Счётчик сообщений — с 00:00 МСК. Заблокированные воркеры скрыты (см. Чёрный список).</i>'
    );
  }

  const owners = new Map();
  for (const r of rows) {
    const key = String(r.telegram_user_id || 'none');
    if (!owners.has(key)) owners.set(key, { row: r, accounts: [] });
    owners.get(key).accounts.push(r);
  }

  const blocks = [];
  for (const { row, accounts } of owners.values()) {
    const owner = row.username ? `@${row.username}` : row.first_name || `id ${row.telegram_user_id}`;
    const lines = accounts.map((a) => {
      const name = accountDisplayName(a.id);
      const status = accountOnline(a.id) ? '🟢 онлайн' : '🔴 не в сети';
      const n = Number(a.seq) || '?';
      return (
        `• <b>${n}.</b> <code>${esc(a.phone)}</code>${name ? ` — ${esc(name)}` : ''}\n` +
        `    ${status} · ИИ ${Number(a.ai) ? 'вкл' : 'выкл'} · ${num(a.sent_today)} сообщ. сегодня`
      );
    });
    blocks.push(`<b>${esc(owner)}</b> — ${accounts.length}\n${lines.join('\n')}`);
  }

  return (
    `<b>📱 Аккаунты в боте</b>\n` +
    `Номеров: <b>${rows.length}</b>, воркеров: <b>${owners.size}</b>\n` +
    `<i>Сообщения — с 00:00 МСК (кнопка «Обновить» пересчитывает сейчас).</i>\n\n` +
    blocks.join('\n\n')
  );
}

async function periodStatsSince(dayStartSql) {
  const [[m]] = await db.execute(
    `SELECT
       SUM(role = 'assistant') AS sent,
       SUM(role = 'assistant' AND content LIKE '[реакция:%') AS reactions,
       SUM(role = 'user') AS incoming,
       COUNT(DISTINCT CASE WHEN role = 'assistant' THEN CONCAT(account_id, ':', peer_id) END) AS chats
     FROM conversation_messages
     WHERE created_at >= ${dayStartSql}`,
  );
  const [[fresh]] = await db.execute(
    `SELECT COUNT(*) AS c FROM (
       SELECT MIN(created_at) AS first_at FROM conversation_messages
       GROUP BY account_id, peer_id
       HAVING first_at >= ${dayStartSql}
     ) t`,
  );
  let voices = { sent: 0, agreed: 0 };
  let dvArchived = 0;
  try {
    const [[v]] = await db.execute(
      `SELECT COUNT(*) AS sent, SUM(status = 'agreed') AS agreed FROM help_requests
       WHERE created_at >= ${dayStartSql}`,
    );
    voices = v;
    const [[d]] = await db.execute(
      `SELECT COUNT(*) AS c FROM autoreply_disabled_peers
       WHERE reason = 'long_on_platform' AND created_at >= ${dayStartSql}`,
    );
    dvArchived = d.c;
  } catch (_) {
    // таблицы создаются лениво — на свежей базе их может не быть
  }
  return { ...m, newDialogs: fresh.c, voices, dvArchived };
}

function formatPeriod(title, s) {
  const reactions = Number(s.reactions || 0);
  return (
    `<b>${title}</b>\n` +
    `    Отправлено: <b>${num(s.sent)}</b>${reactions ? ` (из них реакций ${num(reactions)})` : ''}\n` +
    `    Входящих: ${num(s.incoming)}\n` +
    `    Диалогов с ответами: ${num(s.chats)}, новых: ${num(s.newDialogs)}\n` +
    `    NFT-голосовых: ${num(s.voices.sent)}, согласились помочь: ${num(s.voices.agreed)}\n` +
    `    В архив за «давно на дв»: ${num(s.dvArchived)}`
  );
}

async function buildStatsText() {
  const todaySql = sqlMskDayStart(0);
  const weekSql = sqlMskDayStart(6);
  const [day, week] = await Promise.all([
    periodStatsSince(todaySql),
    periodStatsSince(weekSql),
  ]);
  const [perAccount] = await db.execute(
    `SELECT m.account_id, a.phone,
            SUM(m.created_at >= ${todaySql}) AS day,
            SUM(m.created_at >= ${weekSql}) AS week
     FROM conversation_messages m
     JOIN accounts a ON a.id = m.account_id
     LEFT JOIN users u ON u.id = a.user_id
     WHERE m.role = 'assistant'
       AND m.created_at >= ${weekSql}
       AND COALESCE(u.is_blocked, 0) = 0
     GROUP BY m.account_id, a.phone
     ORDER BY week DESC`,
  );
  const lines = perAccount.map((r) => {
    const name = accountDisplayName(r.account_id) || r.phone;
    return `• ${esc(name)} — ${num(r.day)} / ${num(r.week)}`;
  });
  return (
    '<b>📊 Статистика</b>\n' +
    '<i>Сброс «сегодня» — каждый день в 00:00 МСК. «Обновить» = пересчёт прямо сейчас.</i>\n\n' +
    `${formatPeriod('Сегодня (с 00:00 МСК)', day)}\n\n` +
    `${formatPeriod('7 календарных дней', week)}\n\n` +
    '<b>По аккаунтам</b> (сегодня / 7 дней):\n' +
    (lines.length ? lines.join('\n') : 'нет отправленных сообщений')
  );
}

let pingClient = null;

async function pingOpenAi() {
  if (!pingClient) {
    const { buildOpenAIOptions } = require('./aiResponder');
    pingClient = new OpenAI({ ...buildOpenAIOptions(), maxRetries: 0, timeout: 20000 });
  }
  const started = Date.now();
  try {
    const { response } = await pingClient.chat.completions
      .create({ model: PING_MODEL, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 })
      .withResponse();
    const h = (k) => response.headers.get(k);
    return {
      ok: true,
      ms: Date.now() - started,
      tpm: h('x-ratelimit-limit-tokens'),
      tpmLeft: h('x-ratelimit-remaining-tokens'),
      rpm: h('x-ratelimit-limit-requests'),
      rpmLeft: h('x-ratelimit-remaining-requests'),
    };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, err };
  }
}

async function buildOpenAiText() {
  const notifier = require('./helpRequestNotifier');
  const [ping, [[spend]]] = await Promise.all([
    pingOpenAi(),
    db.execute(
      `SELECT
         SUM(CASE WHEN created_at >= ${sqlMskDayStart(0)} THEN estimated_cost_usd ELSE 0 END) AS c1,
         SUM(CASE WHEN created_at >= ${sqlMskDayStart(0)} THEN 1 ELSE 0 END) AS n1,
         SUM(CASE WHEN created_at >= ${sqlMskDayStart(0)} THEN total_tokens ELSE 0 END) AS t1,
         SUM(CASE WHEN created_at >= ${sqlMskDayStart(6)} THEN estimated_cost_usd ELSE 0 END) AS c7,
         SUM(CASE WHEN created_at >= ${sqlMskDayStart(6)} THEN 1 ELSE 0 END) AS n7,
         SUM(estimated_cost_usd) AS c30,
         COUNT(*) AS n30
       FROM openai_usage_log
       WHERE created_at >= ${sqlMskDayStart(29)}`,
    ),
  ]);

  let status;
  if (ping.ok) {
    status = `✅ работает (ответ за ${(ping.ms / 1000).toFixed(1)} с)`;
  } else {
    const kind = notifier.classifyOpenAiError(ping.err);
    const code = ping.err?.status || ping.err?.response?.status;
    status =
      kind === 'billing'
        ? `❌ <b>закончились деньги</b> — пополни: ${BILLING_URL}`
        : kind === 'auth'
          ? '❌ <b>ключ API не принимается</b> — проверь OPENAI_API_KEY в .env'
          : code === 429
            ? '⚠️ упёрлись в лимит скорости прямо сейчас (обычно проходит за секунды)'
            : `❌ ошибка: <code>${esc(String(ping.err?.message || '').slice(0, 150))}</code>`;
  }

  const limits =
    ping.ok && ping.tpm
      ? `<b>Лимит скорости:</b> ${num(ping.tpm)} токенов/мин (свободно ${num(ping.tpmLeft)}), ` +
        `${num(ping.rpm)} запросов/мин\n`
      : '';

  const { errors } = notifier.getOpenAiHealth();
  const upHours = Math.max(0, (Date.now() - errors.since) / 3600000);
  const upText = upHours < 1 ? `${Math.round(upHours * 60)} мин` : `${upHours.toFixed(1)} ч`;
  const errorsText =
    `<b>Ошибки ответов с запуска бота</b> (${upText}):\n` +
    `    лимит скорости — ${errors.rate_limit}, нет денег — ${errors.billing}, ` +
    `ключ — ${errors.auth}, другие — ${errors.other}`;

  const perReply = Number(spend.n1) ? Number(spend.c1) / Number(spend.n1) : 0;
  const spendText =
    '<b>Расходы на ответы в чатах</b> (по токенам, с 00:00 МСК):\n' +
    `    сегодня — <b>${usd(spend.c1)}</b> (${num(spend.n1)} запросов, ${num(spend.t1)} токенов)\n` +
    `    за 7 дней — <b>${usd(spend.c7)}</b> (${num(spend.n7)} запросов)\n` +
    `    за 30 дней — <b>${usd(spend.c30)}</b> (${num(spend.n30)} запросов)\n` +
    (perReply ? `    1000 ответов обходятся примерно в ${usd(perReply * 1000)}\n` : '') +
    '<i>Распознавание фото/голоса и фоновые запросы сюда не входят — реальный расход немного выше.</i>';

  return (
    '<b>💳 Баланс и статус OpenAI</b>\n\n' +
    `<b>Статус:</b> ${status}\n` +
    limits +
    `\n${errorsText}\n\n` +
    `${spendText}\n\n` +
    '<b>Баланс:</b> OpenAI не отдаёт остаток по обычному API-ключу — точная сумма только в кабинете: ' +
    `${BILLING_URL}\n` +
    'Если деньги закончатся — пришлю тревогу сразу.'
  );
}

// ---------------------------------------------------------------------------
// СИСТЕМА: PROXY_LIST + статус ИИ + перезапуск
// ---------------------------------------------------------------------------

function parseProxyList() {
  const raw = String(process.env.PROXY_LIST || '').trim();
  if (!raw) return [];
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const parts = entry.split(':');
      const type = (parts[0] || '').toLowerCase();
      const host = parts[1];
      const port = Number(parts[2]);
      const user = parts[3] || '';
      const pass = parts.slice(4).join(':') || '';
      return { index, type, host, port, user, pass, raw: entry };
    })
    .filter((p) => p.host && p.port && (p.type === 'socks5' || p.type === 'socks'));
}

async function probeSocksToTelegram(proxy, timeoutMs = PROXY_PROBE_TIMEOUT_MS) {
  const started = Date.now();
  try {
    const { socket } = await SocksClient.createConnection({
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: 5,
        userId: proxy.user || undefined,
        password: proxy.pass || undefined,
      },
      command: 'connect',
      destination: { host: TG_PROBE_HOST, port: TG_PROBE_PORT },
      timeout: timeoutMs,
    });
    try {
      socket.destroy();
    } catch (_) {
      /* ignore */
    }
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: String(err?.message || err).slice(0, 80) };
  }
}

async function probeAllProxies({ timeoutMs = PROXY_PROBE_TIMEOUT_MS, concurrency = 3 } = {}) {
  const list = parseProxyList();
  if (!list.length) return [];
  // Быстрый режим: все сразу; полный — пачками по concurrency.
  if (concurrency <= 0 || concurrency >= list.length) {
    return Promise.all(
      list.map(async (p) => ({ ...p, ...(await probeSocksToTelegram(p, timeoutMs)) })),
    );
  }
  const results = [];
  for (let i = 0; i < list.length; i += concurrency) {
    const chunk = list.slice(i, i + concurrency);
    const probed = await Promise.all(
      chunk.map(async (p) => {
        const r = await probeSocksToTelegram(p, timeoutMs);
        return { ...p, ...r };
      }),
    );
    results.push(...probed);
  }
  return results;
}

/** Короткий отчёт: OpenAI + прокси → TG + онлайн аккаунтов. ~2–3 с. */
async function buildQuickCheckText() {
  const notifier = require('./helpRequestNotifier');
  const tc = require('./telegramClient');
  const started = Date.now();

  const [proxyResults, ping, accountRows] = await Promise.all([
    probeAllProxies({ timeoutMs: QUICK_PROBE_TIMEOUT_MS, concurrency: 0 }),
    pingOpenAi(),
    db
      .execute(
        `SELECT a.id, a.is_autoreply_enabled AS ai
         FROM accounts a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE COALESCE(u.is_blocked, 0) = 0`,
      )
      .then(([rows]) => rows)
      .catch(() => []),
  ]);

  const total = accountRows.length;
  const aiOn = accountRows.filter((r) => Number(r.ai)).length;
  const online = accountRows.filter((r) => {
    try {
      return tc.isActive(r.id);
    } catch (_) {
      return false;
    }
  }).length;

  const okProxies = proxyResults.filter((p) => p.ok).length;
  const proxyTotal = proxyResults.length;

  let aiLine;
  if (ping.ok) {
    aiLine = `✅ OpenAI · ${(ping.ms / 1000).toFixed(1)} с`;
  } else {
    const kind = notifier.classifyOpenAiError(ping.err);
    aiLine =
      kind === 'billing'
        ? '❌ OpenAI · нет денег'
        : kind === 'auth'
          ? '❌ OpenAI · ключ'
          : `❌ OpenAI · ${esc(String(ping.err?.message || 'ошибка').slice(0, 60))}`;
  }

  let proxyLine;
  if (!proxyTotal) {
    proxyLine = '⚪ Прокси · PROXY_LIST пуст';
  } else if (okProxies === proxyTotal) {
    proxyLine = `✅ Прокси · ${okProxies}/${proxyTotal} до Telegram`;
  } else if (okProxies === 0) {
    proxyLine = `❌ Прокси · 0/${proxyTotal} — до Telegram никто не достучится`;
  } else {
    proxyLine = `🟡 Прокси · ${okProxies}/${proxyTotal} ок`;
  }

  const dead = proxyResults.filter((p) => !p.ok).slice(0, 5);
  const deadLines = dead.length
    ? '\n' +
      dead
        .map((p) => `    ❌ <code>${esc(p.host)}:${p.port}</code> · ${esc(p.error || 'timeout')}`)
        .join('\n') +
      (proxyResults.filter((p) => !p.ok).length > 5 ? '\n    …' : '')
    : '';

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const verdict =
    ping.ok && (proxyTotal === 0 || okProxies > 0)
      ? '🟢 В целом ок'
      : !ping.ok && okProxies === 0 && proxyTotal > 0
        ? '🔴 ИИ и прокси лежат'
        : !ping.ok
          ? '🟠 ИИ не отвечает'
          : '🟠 Прокси плохие';

  return (
    '<b>⚡ Быстрая проверка</b>\n\n' +
    `${verdict}\n` +
    `${aiLine}\n` +
    `${proxyLine}${deadLines}\n` +
    `📱 Аккаунты · онлайн <b>${online}</b> / ${total}, AI ${aiOn}\n` +
    `⏱ ${elapsed} с · uptime ${formatUptime(process.uptime())}\n\n` +
    '<i>Короткий таймаут 2.5 с. Подробный прогон — «Система».</i>'
  );
}

function formatUptime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}д ${h % 24}ч`;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м`;
}

async function buildSystemText() {
  const notifier = require('./helpRequestNotifier');
  const tc = require('./telegramClient');

  const [proxyResults, ping, [[acc]]] = await Promise.all([
    probeAllProxies(),
    pingOpenAi(),
    db.execute(
      `SELECT COUNT(*) AS total,
              SUM(is_autoreply_enabled = 1) AS ai_on
       FROM accounts`,
    ),
  ]);

  let online = 0;
  try {
    const [rows] = await db.execute('SELECT id FROM accounts');
    online = rows.filter((r) => tc.isActive(r.id)).length;
  } catch (_) {
    online = 0;
  }

  const okProxies = proxyResults.filter((p) => p.ok).length;
  const proxyLines = proxyResults.length
    ? proxyResults
        .map((p, i) => {
          const mark = p.ok ? '✅' : '❌';
          const ms = p.ok ? `${p.ms}мс` : (p.error || 'timeout');
          const star = i === 0 ? ' ← OpenAI/первый' : '';
          return `${mark} <code>${esc(p.host)}:${p.port}</code> — ${esc(ms)}${star}`;
        })
        .join('\n')
    : '<i>PROXY_LIST пуст в .env</i>';

  let aiStatus;
  if (ping.ok) {
    aiStatus = `✅ OpenAI отвечает (${(ping.ms / 1000).toFixed(1)} с)`;
  } else {
    const kind = notifier.classifyOpenAiError(ping.err);
    aiStatus =
      kind === 'billing'
        ? '❌ OpenAI: нет денег'
        : kind === 'auth'
          ? '❌ OpenAI: ключ не принимается'
          : `❌ OpenAI: <code>${esc(String(ping.err?.message || '').slice(0, 120))}</code>`;
  }

  const { errors, alert } = notifier.getOpenAiHealth();
  const lastErr = errors.last
    ? `\n    последняя: ${esc(errors.last.kind)} — ${esc(errors.last.message || '')}`
    : '';
  const alertLine = alert.active
    ? `\n⚠️ Тревога OpenAI активна (${esc(alert.kind)}), потеряно ответов: ${num(alert.lost)}`
    : '';

  const tgStatus =
    okProxies === 0 && proxyResults.length
      ? '🔴 до Telegram через прокси сейчас никто не достучится'
      : okProxies < proxyResults.length
        ? `🟡 часть прокси мертва (${okProxies}/${proxyResults.length} ок)`
        : proxyResults.length
          ? '🟢 прокси до Telegram отвечают'
          : '⚪ прокси не заданы';

  return (
    '<b>🛠 Система</b>\n\n' +
    `<b>ИИ / процесс</b>\n` +
    `    ${aiStatus}\n` +
    `    Процесс uptime: <b>${formatUptime(process.uptime())}</b>\n` +
    `    Аккаунты: онлайн <b>${online}</b> / всего ${num(acc.total)}, ИИ вкл: ${num(acc.ai_on)}\n` +
    `    Ошибки OpenAI с запуска: rate ${errors.rate_limit}, billing ${errors.billing}, ` +
    `auth ${errors.auth}, other ${errors.other}` +
    lastErr +
    alertLine +
    `\n\n<b>Прокси → Telegram</b> (${TG_PROBE_HOST}:${TG_PROBE_PORT})\n` +
    `    Сводка: ${tgStatus}\n` +
    `${proxyLines}\n\n` +
    '<i>Проверка: SOCKS5 connect до DC Telegram. Пароли не показываю. ' +
    'Если все ❌ — аккаунты не получают сообщения (как сегодня утром).</i>'
  );
}

async function scheduleBotRestart(api, chatId, messageId) {
  await tg(api, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'HTML',
    text:
      '♻️ <b>Перезапускаю tgbot…</b>\n\n' +
      'Через пару секунд процесс уйдёт в pm2 restart. ' +
      'Сессии переподключатся за ~10–30 с. Если меню пропадёт — снова /menu.',
  });
  setTimeout(() => {
    exec('pm2 restart tgbot --update-env', (err, stdout, stderr) => {
      if (err) {
        console.error('[adminMenu] pm2 restart failed:', err.message, stderr);
      } else {
        console.log('[adminMenu] pm2 restart ok:', String(stdout || '').slice(0, 200));
      }
    });
  }, 800);
}

// ---------------------------------------------------------------------------
// ЧЁРНЫЙ СПИСОК
// Блокировка: users.is_blocked = 1 (мини-апп отвечает 403, /start — «Доступ
// закрыт»), отписка от уведомлений, строка workers уходит в бэкап (анкеты
// перестают пускать), его номера отключаются. Разблокировка всё возвращает.
// ---------------------------------------------------------------------------

const BLOCK_INPUT_TTL_MS = 5 * 60 * 1000;
let blockInputUntil = 0;

async function ensureBlacklistSchema() {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS blacklist_worker_backup (
       telegram_user_id BIGINT NOT NULL PRIMARY KEY,
       row_json TEXT NOT NULL,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
     )`,
  );
}

function userTitle(u) {
  if (u.username) return `@${u.username}`;
  if (u.first_name) return u.first_name;
  return `id ${u.telegram_user_id}`;
}

async function findUserByInput(input) {
  const raw = String(input || '')
    .trim()
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^@/, '');
  if (!raw) return null;

  if (/^\d{5,15}$/.test(raw)) {
    const [[u]] = await db.execute(
      'SELECT id, telegram_user_id, username, first_name, is_blocked FROM users WHERE telegram_user_id = ? LIMIT 1',
      [raw],
    );
    return u || { id: null, telegram_user_id: raw, username: null, first_name: null, is_blocked: 0 };
  }
  if (!/^[A-Za-z0-9_]{3,32}$/.test(raw)) return null;

  const [[u]] = await db.execute(
    'SELECT id, telegram_user_id, username, first_name, is_blocked FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1',
    [raw],
  );
  if (u) return u;
  try {
    const [[w]] = await db.execute('SELECT id FROM workers WHERE LOWER(login) = LOWER(?) LIMIT 1', [raw]);
    if (w) return { id: null, telegram_user_id: String(w.id), username: raw, first_name: null, is_blocked: 0 };
  } catch (_) {
    // таблицы workers может не быть
  }
  return null;
}

async function userAccounts(userId) {
  if (!userId) return [];
  const [rows] = await db.execute('SELECT id, phone, session_string FROM accounts WHERE user_id = ?', [userId]);
  return rows;
}

async function buildBlacklistView(notice = '') {
  const [rows] = await db.execute(
    `SELECT u.telegram_user_id, u.username, u.first_name,
            (SELECT COUNT(*) FROM accounts a WHERE a.user_id = u.id) AS accounts
     FROM users u WHERE u.is_blocked = 1 ORDER BY u.username`,
  );
  const lines = rows.map(
    (u) => `• ${esc(userTitle(u))} — <code>${esc(u.telegram_user_id)}</code>` +
      (Number(u.accounts)
        ? `, номеров в БД: ${u.accounts} (отключены, не в общем списке)`
        : ', номеров в БД: 0'),
  );
  const text =
    (notice ? `${notice}\n\n` : '') +
    '<b>🚫 Чёрный список</b>\n\n' +
    (lines.length ? lines.join('\n') : 'Пусто — никто не заблокирован.') +
    '\n\n<i>Блокировка не удаляет человека из списка сама — только кнопка «Разблокировать». ' +
    'Номера при блоке отключаются, но строки в БД остаются (их можно отдать другому воркеру). ' +
    'В «Аккаунты в боте» заблокированные не показываются.</i>' +
    (lines.length ? '\n\nЧтобы разблокировать — нажми на человека ниже.' : '');

  const keyboard = rows.slice(0, 30).map((u) => [
    { text: `✅ Разблокировать ${userTitle(u)}`, callback_data: `adm:unb:${u.telegram_user_id}` },
  ]);
  keyboard.push([{ text: '➕ Добавить в чёрный список', callback_data: 'adm:bl_add' }]);
  keyboard.push([{ text: '« Меню', callback_data: 'adm:menu' }]);
  return { text, reply_markup: { inline_keyboard: keyboard } };
}

async function blockUser(tgId) {
  await ensureBlacklistSchema();
  const [[user]] = await db.execute('SELECT id FROM users WHERE telegram_user_id = ? LIMIT 1', [tgId]);
  let userId = user?.id;
  if (userId) {
    await db.execute('UPDATE users SET is_blocked = 1 WHERE id = ?', [userId]);
  } else {
    const [res] = await db.execute('INSERT INTO users (telegram_user_id, is_blocked) VALUES (?, 1)', [tgId]);
    userId = res?.insertId || null;
  }
  await db.execute('DELETE FROM notification_subscribers WHERE chat_id = ?', [String(tgId)]).catch(() => {});

  let workerRemoved = false;
  try {
    const [workerRows] = await db.execute('SELECT * FROM workers WHERE id = ?', [tgId]);
    if (workerRows.length) {
      await db.execute(
        `INSERT INTO blacklist_worker_backup (telegram_user_id, row_json) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE row_json = VALUES(row_json), created_at = CURRENT_TIMESTAMP`,
        [tgId, JSON.stringify(workerRows[0])],
      );
      await db.execute('DELETE FROM workers WHERE id = ?', [tgId]);
      workerRemoved = true;
    }
  } catch (err) {
    console.error('[adminMenu] workers при блокировке:', err.message);
  }

  let stopped = 0;
  const tc = require('./telegramClient');
  for (const acc of await userAccounts(userId)) {
    if (tc.isActive(acc.id)) stopped += 1;
    await tc.deactivateAccount(acc.id).catch(() => {});
  }
  return { workerRemoved, stopped };
}

async function unblockUser(tgId) {
  await ensureBlacklistSchema();
  const [[user]] = await db.execute('SELECT id FROM users WHERE telegram_user_id = ? LIMIT 1', [tgId]);
  if (user) await db.execute('UPDATE users SET is_blocked = 0 WHERE id = ?', [user.id]);

  let workerRestored = false;
  try {
    const [[backup]] = await db.execute(
      'SELECT row_json FROM blacklist_worker_backup WHERE telegram_user_id = ?',
      [tgId],
    );
    const [[exists]] = await db.execute('SELECT id FROM workers WHERE id = ?', [tgId]);
    if (backup && !exists) {
      const row = JSON.parse(backup.row_json);
      const cols = Object.keys(row).filter((c) => /^\w+$/.test(c));
      await db.execute(
        `INSERT INTO workers (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map((c) => row[c]),
      );
      workerRestored = true;
    }
    if (backup) await db.execute('DELETE FROM blacklist_worker_backup WHERE telegram_user_id = ?', [tgId]);
  } catch (err) {
    console.error('[adminMenu] workers при разблокировке:', err.message);
  }

  let started = 0;
  const tc = require('./telegramClient');
  for (const acc of await userAccounts(user?.id)) {
    if (!acc.session_string) continue;
    if ((await tc.activateAccount(acc.id, acc.session_string).catch(() => false)) === true) started += 1;
  }
  return { workerRestored, started };
}

/**
 * Текст от админа, пока ждём ввод (доступ / сайты / чёрный список).
 * Возвращает true, если сообщение обработано здесь.
 */
async function handleAdminText(api, chatId, text) {
  await operatorAccess.isAdmin(chatId); // прогрев кэша
  if (!isAdminChat(chatId)) return false;

  const sendWizard = async (a, c, plain, view) => {
    if (view) {
      await tg(a, 'sendMessage', {
        chat_id: c,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        text: view.text,
        reply_markup: view.reply_markup,
      });
      return;
    }
    await tg(a, 'sendMessage', {
      chat_id: c,
      parse_mode: 'HTML',
      text: plain,
    });
  };

  // Мастер доступа (тестер/админ)
  if (opsAdmin.isWizardActive()) {
    if (await opsAdmin.handleText(api, chatId, text, sendWizard)) return true;
  }

  if (Date.now() > blockInputUntil) return false;
  if (text.startsWith('/')) {
    blockInputUntil = 0;
    return false;
  }
  blockInputUntil = 0;

  const user = await findUserByInput(text);
  if (!user) {
    await tg(api, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text: `Не нашёл <b>${esc(text)}</b> среди пользователей бота. Пришли @username, под которым он заходил в мини-апп, или его Telegram ID (цифрами).`,
      reply_markup: { inline_keyboard: [[
        { text: '🔁 Ввести ещё раз', callback_data: 'adm:bl_add' },
        { text: '« Чёрный список', callback_data: 'adm:bl' },
      ]] },
    });
    return true;
  }
  if (isAdminChat(user.telegram_user_id)) {
    await tg(api, 'sendMessage', { chat_id: chatId, text: 'Себя заблокировать нельзя 🙂' });
    return true;
  }
  if (Number(user.is_blocked) === 1) {
    const view = await buildBlacklistView(`ℹ️ ${esc(userTitle(user))} уже в чёрном списке.`);
    await tg(api, 'sendMessage', { chat_id: chatId, parse_mode: 'HTML', ...view });
    return true;
  }

  const accounts = await userAccounts(user.id);
  const phones = accounts.map((a) => `<code>${esc(a.phone)}</code>`).join(', ');
  await tg(api, 'sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text:
      `Заблокировать <b>${esc(userTitle(user))}</b> (<code>${esc(user.telegram_user_id)}</code>)?\n\n` +
      (user.id ? '' : 'В мини-аппе он ещё не был — заблокирую заранее по ID.\n') +
      (accounts.length ? `Его номера (${accounts.length}): ${phones} — ИИ на них остановится.` : 'Номеров у него нет.'),
    reply_markup: { inline_keyboard: [[
      { text: '🚫 Заблокировать', callback_data: `adm:blk:${user.telegram_user_id}` },
      { text: 'Отмена', callback_data: 'adm:bl' },
    ]] },
  });
  return true;
}

async function handleBlacklistCallback(api, data, target) {
  if (data === 'adm:bl') {
    blockInputUntil = 0;
    await tg(api, 'editMessageText', { ...target, ...(await buildBlacklistView()) });
    return;
  }
  if (data === 'adm:bl_add') {
    blockInputUntil = Date.now() + BLOCK_INPUT_TTL_MS;
    await tg(api, 'editMessageText', {
      ...target,
      text: 'Пришли следующим сообщением <b>@username</b> или <b>Telegram ID</b> того, кого заблокировать.',
      reply_markup: { inline_keyboard: [[{ text: 'Отмена', callback_data: 'adm:bl' }]] },
    });
    return;
  }

  const [, action, tgId] = data.match(/^adm:(blk|unb):(\d+)$/) || [];
  if (!action) return;
  if (action === 'blk' && isAdminChat(tgId)) return;

  const [[u]] = await db.execute(
    'SELECT telegram_user_id, username, first_name FROM users WHERE telegram_user_id = ? LIMIT 1',
    [tgId],
  );
  const title = esc(userTitle(u || { telegram_user_id: tgId }));
  await tg(api, 'editMessageText', {
    ...target,
    text: action === 'blk' ? `⏳ Блокирую ${title}…` : `⏳ Разблокирую ${title}…`,
  });

  let notice;
  try {
    if (action === 'blk') {
      const r = await blockUser(tgId);
      notice =
        `🚫 ${title} заблокирован.` +
        (r.stopped ? ` Остановлено номеров: ${r.stopped}.` : '') +
        (r.workerRemoved ? ' Доступ к анкетам закрыт.' : '');
    } else {
      const r = await unblockUser(tgId);
      notice =
        `✅ ${title} разблокирован.` +
        (r.started ? ` Снова запущено номеров: ${r.started}.` : '') +
        (r.workerRestored ? ' Доступ к анкетам возвращён.' : '');
    }
  } catch (err) {
    console.error(`[adminMenu] ${data}:`, err.message);
    notice = `❌ Не получилось: <code>${esc(err.message)}</code>`;
  }
  await tg(api, 'editMessageText', { ...target, ...(await buildBlacklistView(notice)) });
}

// ---------------------------------------------------------------------------
// ОБРАБОТКА КОМАНД И КНОПОК
// ---------------------------------------------------------------------------

async function sendMenu(api, chatId) {
  let text;
  try {
    text = await buildMenuHomeText();
  } catch (err) {
    console.error('[adminMenu] home:', err.message);
    text = '<b>Админ-меню</b>\n\nВыбери раздел:';
  }
  await tg(api, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: menuKeyboard(chatId),
  });
}

const SECTIONS = {
  'adm:accounts': { build: buildAccountsText, loading: '⏳ Собираю список аккаунтов…' },
  'adm:stats': { build: buildStatsText, loading: '⏳ Считаю статистику…' },
  'adm:openai': { build: buildOpenAiText, loading: '⏳ Проверяю OpenAI…' },
  'adm:system': { build: buildSystemText, loading: '⏳ Проверяю прокси и ИИ…', keyboard: systemKeyboard },
  'adm:check': {
    build: buildQuickCheckText,
    loading: '⚡ Проверяю OpenAI и прокси…',
    keyboard: checkKeyboard,
  },
};

async function handleCallback(api, query) {
  const chatId = query.message?.chat?.id;
  await operatorAccess.isAdmin(chatId); // прогрев кэша ролей
  if (!isAdminChat(chatId) || !String(query.data || '').startsWith('adm:')) {
    await tg(api, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Нет доступа' });
    return;
  }
  await tg(api, 'answerCallbackQuery', { callback_query_id: query.id });
  const target = { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', disable_web_page_preview: true };

  if (query.data === 'adm:menu') {
    blockInputUntil = 0;
    opsAdmin.clearWizard();
    try {
      require('./workerConnect').clearWizard(chatId);
    } catch (_) {}
    let text;
    try {
      text = await buildMenuHomeText();
    } catch (err) {
      console.error('[adminMenu] home:', err.message);
      text = '<b>Админ-меню</b>\n\nВыбери раздел:';
    }
    await tg(api, 'editMessageText', {
      ...target,
      text,
      reply_markup: menuKeyboard(chatId),
    });
    return;
  }
  if (opsAdmin.isOpsCallback(query.data)) {
    // Управление доступом — только суперадмин
    if (!operatorAccess.isSuperAdmin(chatId)) {
      await tg(api, 'editMessageText', {
        ...target,
        text: '❌ Управлять тестерами/админами может только суперадмин.',
        reply_markup: {
          inline_keyboard: [[{ text: '« Меню', callback_data: 'adm:menu' }]],
        },
      });
      return;
    }
    try {
      await opsAdmin.handleCallback(api, query.data, target, tg);
    } catch (err) {
      console.error(`[adminMenu] ${query.data}:`, err.message);
      await tg(api, 'editMessageText', {
        ...target,
        text: `❌ Ошибка доступа: <code>${esc(err.message)}</code>`,
        reply_markup: {
          inline_keyboard: [[{ text: '« Доступ', callback_data: 'adm:ops' }]],
        },
      });
    }
    return;
  }
  if (query.data === 'adm:dt' || query.data === 'adm:dating' || String(query.data || '').startsWith('dt:')) {
    let text;
    try {
      text = await buildMenuHomeText();
    } catch (_) {
      text = '<b>Админ-меню</b>\n\nВыбери раздел:';
    }
    await tg(api, 'editMessageText', {
      ...target,
      text,
      reply_markup: menuKeyboard(chatId),
    });
    return;
  }
  if (query.data.startsWith('adm:bl') || query.data.startsWith('adm:unb:')) {
    await handleBlacklistCallback(api, query.data, target);
    return;
  }
  if (query.data === 'adm:restart') {
    await tg(api, 'editMessageText', {
      ...target,
      text:
        '♻️ <b>Перезапустить бота?</b>\n\n' +
        'PM2 перезапустит процесс <code>tgbot</code>. ' +
        'Аккаунты на ~10–30 сек отвалятся и сами подключатся. ' +
        'Используй, если прокси ожил, а чаты всё ещё молчат.',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Да, перезапустить', callback_data: 'adm:restart_yes' }],
          [{ text: 'Отмена', callback_data: 'adm:system' }],
        ],
      },
    });
    return;
  }
  if (query.data === 'adm:restart_yes') {
    await scheduleBotRestart(api, chatId, query.message.message_id);
    return;
  }
  const section = SECTIONS[query.data];
  if (!section) return;
  await tg(api, 'editMessageText', { ...target, text: section.loading });
  let text;
  try {
    text = await section.build();
  } catch (err) {
    console.error(`[adminMenu] ${query.data}:`, err.message);
    text = `❌ Не удалось собрать данные: <code>${esc(err.message)}</code>`;
  }
  const keyboard = typeof section.keyboard === 'function' ? section.keyboard() : sectionKeyboard(query.data);
  await tg(api, 'editMessageText', { ...target, text: text.slice(0, 4000), reply_markup: keyboard });
}

async function registerCommands(api) {
  await operatorAccess.ensureSchema();
  await operatorAccess.listOperators().catch(() => {});
  const adminCmds = [
    { command: 'menu', description: 'Админ-меню' },
    { command: 'connect', description: 'Подключить аккаунт' },
  ];
  const workerCmds = [
    { command: 'menu', description: 'Меню (номера)' },
    { command: 'connect', description: 'Подключить аккаунт' },
    { command: 'start', description: 'Старт / уведомления' },
  ];
  await tg(api, 'setMyCommands', {
    commands: adminCmds,
    scope: { type: 'chat', chat_id: Number(ADMIN_CHAT_ID) },
  });
  try {
    const rows = await operatorAccess.listOperators();
    for (const r of rows) {
      if (!r.telegram_user_id) continue;
      if (operatorAccess.isSuperAdmin(r.telegram_user_id)) continue;
      const cmds = r.role === 'admin' ? adminCmds : workerCmds;
      await tg(api, 'setMyCommands', {
        commands: cmds,
        scope: { type: 'chat', chat_id: Number(r.telegram_user_id) },
      });
    }
  } catch (err) {
    console.error('[adminMenu] registerCommands for DB operators:', err.message);
  }
}

module.exports = { isAdminChat, sendMenu, handleCallback, handleAdminText, registerCommands };
