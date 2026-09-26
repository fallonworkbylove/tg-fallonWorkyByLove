/**
 * Админ-меню в боте-уведомителе (BOT_TOKEN). Доступно только чату
 * ADMIN_ALERT_CHAT_ID (@fallonsociapat): /menu → кнопки
 * «Аккаунты в боте», «Статистика», «Баланс и статус OpenAI».
 */

const OpenAI = require('openai');
const db = require('../db');

const ADMIN_CHAT_ID = String(process.env.ADMIN_ALERT_CHAT_ID || '8588744561');
const PING_MODEL = 'gpt-4o-mini';
const BILLING_URL = 'https://platform.openai.com/settings/organization/billing';

const MENU_TEXT = '<b>Админ-меню</b>\n\nВыбери раздел:';
const MENU_KEYBOARD = {
  inline_keyboard: [
    [{ text: '📱 Аккаунты в боте', callback_data: 'adm:accounts' }],
    [{ text: '📊 Статистика', callback_data: 'adm:stats' }],
    [{ text: '💳 Баланс и статус OpenAI', callback_data: 'adm:openai' }],
  ],
};

function sectionKeyboard(refreshData) {
  return {
    inline_keyboard: [[
      { text: '🔄 Обновить', callback_data: refreshData },
      { text: '« Меню', callback_data: 'adm:menu' },
    ]],
  };
}

function isAdminChat(chatId) {
  return String(chatId) === ADMIN_CHAT_ID;
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

async function buildAccountsText() {
  const [rows] = await db.execute(
    `SELECT a.id, a.phone, a.is_autoreply_enabled AS ai,
            u.username, u.first_name, u.telegram_user_id,
            (SELECT COUNT(*) FROM conversation_messages m
              WHERE m.account_id = a.id AND m.role = 'assistant'
                AND m.created_at > NOW() - INTERVAL 24 HOUR) AS sent_24h
     FROM accounts a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY u.username, a.id`,
  );
  if (!rows.length) return '<b>📱 Аккаунты в боте</b>\n\nНи одного подключённого номера.';

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
      return (
        `• <code>${esc(a.phone)}</code>${name ? ` — ${esc(name)}` : ''}\n` +
        `    ${status} · ИИ ${Number(a.ai) ? 'вкл' : 'выкл'} · ${num(a.sent_24h)} сообщ. за сутки`
      );
    });
    blocks.push(`<b>${esc(owner)}</b> — ${accounts.length}\n${lines.join('\n')}`);
  }

  return (
    `<b>📱 Аккаунты в боте</b>\n` +
    `Номеров: <b>${rows.length}</b>, воркеров: <b>${owners.size}</b>\n\n` +
    blocks.join('\n\n')
  );
}

async function periodStats(hours) {
  const [[m]] = await db.execute(
    `SELECT
       SUM(role = 'assistant') AS sent,
       SUM(role = 'assistant' AND content LIKE '[реакция:%') AS reactions,
       SUM(role = 'user') AS incoming,
       COUNT(DISTINCT CASE WHEN role = 'assistant' THEN CONCAT(account_id, ':', peer_id) END) AS chats
     FROM conversation_messages
     WHERE created_at > NOW() - INTERVAL ? HOUR`,
    [hours],
  );
  const [[fresh]] = await db.execute(
    `SELECT COUNT(*) AS c FROM (
       SELECT MIN(created_at) AS first_at FROM conversation_messages
       GROUP BY account_id, peer_id
       HAVING first_at > NOW() - INTERVAL ? HOUR
     ) t`,
    [hours],
  );
  let voices = { sent: 0, agreed: 0 };
  let dvArchived = 0;
  try {
    const [[v]] = await db.execute(
      `SELECT COUNT(*) AS sent, SUM(status = 'agreed') AS agreed FROM help_requests
       WHERE created_at > NOW() - INTERVAL ? HOUR`,
      [hours],
    );
    voices = v;
    const [[d]] = await db.execute(
      `SELECT COUNT(*) AS c FROM autoreply_disabled_peers
       WHERE reason = 'long_on_platform' AND created_at > NOW() - INTERVAL ? HOUR`,
      [hours],
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
  const [day, week] = await Promise.all([periodStats(24), periodStats(24 * 7)]);
  const [perAccount] = await db.execute(
    `SELECT m.account_id, a.phone,
            SUM(m.created_at > NOW() - INTERVAL 24 HOUR) AS day,
            COUNT(*) AS week
     FROM conversation_messages m
     JOIN accounts a ON a.id = m.account_id
     WHERE m.role = 'assistant' AND m.created_at > NOW() - INTERVAL 7 DAY
     GROUP BY m.account_id, a.phone
     ORDER BY week DESC`,
  );
  const lines = perAccount.map((r) => {
    const name = accountDisplayName(r.account_id) || r.phone;
    return `• ${esc(name)} — ${num(r.day)} / ${num(r.week)}`;
  });
  return (
    '<b>📊 Статистика</b>\n\n' +
    `${formatPeriod('За сутки', day)}\n\n` +
    `${formatPeriod('За неделю', week)}\n\n` +
    '<b>По аккаунтам</b> (сутки / неделя):\n' +
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
         SUM(CASE WHEN created_at > NOW() - INTERVAL 24 HOUR THEN estimated_cost_usd ELSE 0 END) AS c1,
         SUM(CASE WHEN created_at > NOW() - INTERVAL 24 HOUR THEN 1 ELSE 0 END) AS n1,
         SUM(CASE WHEN created_at > NOW() - INTERVAL 24 HOUR THEN total_tokens ELSE 0 END) AS t1,
         SUM(CASE WHEN created_at > NOW() - INTERVAL 7 DAY THEN estimated_cost_usd ELSE 0 END) AS c7,
         SUM(CASE WHEN created_at > NOW() - INTERVAL 7 DAY THEN 1 ELSE 0 END) AS n7,
         SUM(estimated_cost_usd) AS c30,
         COUNT(*) AS n30
       FROM openai_usage_log
       WHERE created_at > NOW() - INTERVAL 30 DAY`,
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
    '<b>Расходы на ответы в чатах</b> (по токенам):\n' +
    `    за сутки — <b>${usd(spend.c1)}</b> (${num(spend.n1)} запросов, ${num(spend.t1)} токенов)\n` +
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
// ОБРАБОТКА КОМАНД И КНОПОК
// ---------------------------------------------------------------------------

async function sendMenu(api, chatId) {
  await tg(api, 'sendMessage', { chat_id: chatId, text: MENU_TEXT, parse_mode: 'HTML', reply_markup: MENU_KEYBOARD });
}

const SECTIONS = {
  'adm:accounts': { build: buildAccountsText, loading: '⏳ Собираю список аккаунтов…' },
  'adm:stats': { build: buildStatsText, loading: '⏳ Считаю статистику…' },
  'adm:openai': { build: buildOpenAiText, loading: '⏳ Проверяю OpenAI…' },
};

async function handleCallback(api, query) {
  const chatId = query.message?.chat?.id;
  if (!isAdminChat(chatId) || !String(query.data || '').startsWith('adm:')) {
    await tg(api, 'answerCallbackQuery', { callback_query_id: query.id, text: 'Нет доступа' });
    return;
  }
  await tg(api, 'answerCallbackQuery', { callback_query_id: query.id });
  const target = { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'HTML', disable_web_page_preview: true };

  if (query.data === 'adm:menu') {
    await tg(api, 'editMessageText', { ...target, text: MENU_TEXT, reply_markup: MENU_KEYBOARD });
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
  await tg(api, 'editMessageText', { ...target, text: text.slice(0, 4000), reply_markup: sectionKeyboard(query.data) });
}

async function registerCommands(api) {
  await tg(api, 'setMyCommands', {
    commands: [{ command: 'menu', description: 'Админ-меню' }],
    scope: { type: 'chat', chat_id: Number(ADMIN_CHAT_ID) },
  });
}

module.exports = { isAdminChat, sendMenu, handleCallback, registerCommands };
