/**
 * Общий CRUD для аккаунтов сайтов знакомств (miniapp API + /menu).
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');

const SITES = new Set(['tagged']);

async function ensureSchema() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS dating_site_accounts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      site VARCHAR(32) NOT NULL DEFAULT 'tagged',
      login VARCHAR(255) NOT NULL,
      password_enc VARCHAR(512) NOT NULL DEFAULT '',
      persona_name VARCHAR(120) NOT NULL DEFAULT '',
      persona_prompt TEXT,
      telegram_username VARCHAR(128) NOT NULL DEFAULT '',
      telegram_account_id INT NULL,
      dolphin_profile_id VARCHAR(64) NULL,
      language VARCHAR(8) NOT NULL DEFAULT 'en',
      invite_after_min INT NOT NULL DEFAULT 180,
      invite_after_max INT NOT NULL DEFAULT 240,
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,
      status VARCHAR(32) NOT NULL DEFAULT 'idle',
      last_error VARCHAR(512) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_dating_user (user_id),
      INDEX idx_dating_site (site)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // Старые БД могли создаться без dolphin_profile_id
  try {
    await db.execute(
      'ALTER TABLE dating_site_accounts ADD COLUMN dolphin_profile_id VARCHAR(64) NULL AFTER telegram_account_id',
    );
  } catch (_) {
    /* already exists */
  }
}

function normalizeDolphinId(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  return s.slice(0, 64);
}

function normalizeSite(value) {
  const s = String(value || 'tagged').toLowerCase().trim();
  return SITES.has(s) ? s : null;
}

function normalizeTg(value) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .slice(0, 128);
}

function isValidTgUsername(value) {
  const u = normalizeTg(value);
  return /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(u);
}

function publicRow(row) {
  const pass = String(row.password_enc || '');
  return {
    id: row.id,
    user_id: row.user_id,
    site: row.site,
    login: row.login,
    has_password: pass.length > 0,
    password_masked: pass ? '••••••••' : '',
    persona_name: row.persona_name || '',
    persona_prompt: row.persona_prompt || '',
    telegram_username: row.telegram_username || '',
    telegram_account_id: row.telegram_account_id,
    dolphin_profile_id: row.dolphin_profile_id || null,
    language: row.language || 'en',
    invite_after_min: Number(row.invite_after_min) || 180,
    invite_after_max: Number(row.invite_after_max) || 240,
    is_enabled: Number(row.is_enabled) === 1,
    status: row.status || 'idle',
    last_error: row.last_error || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function invitePhrase(tg, lang = 'en') {
  const display = `@${normalizeTg(tg) || 'username'}`;
  const en = [
    `hey this app is kinda laggy for me — you on telegram? mine is ${display}`,
    `wanna continue on tg? easier to chat there — ${display}`,
    `i talk more on telegram tbh — ${display} if you're down`,
  ];
  const ru = [
    `тут неудобно переписываться, давай в телегу? у меня ${display}`,
    `добавь в телеграм ${display} — тут глючит иногда`,
    `удобнее в тг продолжить, я там ${display}`,
  ];
  const bank = String(lang).toLowerCase().startsWith('ru') ? ru : en;
  return bank[Math.floor(Math.random() * bank.length)];
}

async function listAccounts({ userId = null, enabledOnly = false } = {}) {
  await ensureSchema();
  const where = [];
  const params = [];
  if (userId != null) {
    where.push('user_id = ?');
    params.push(userId);
  }
  if (enabledOnly) {
    where.push('is_enabled = 1');
  }
  const sql =
    `SELECT * FROM dating_site_accounts` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY id DESC`;
  const [rows] = await db.execute(sql, params);
  return rows;
}

async function getAccount(id, userId = null) {
  await ensureSchema();
  if (userId != null) {
    const [[row]] = await db.execute(
      'SELECT * FROM dating_site_accounts WHERE id = ? AND user_id = ? LIMIT 1',
      [id, userId],
    );
    return row || null;
  }
  const [[row]] = await db.execute(
    'SELECT * FROM dating_site_accounts WHERE id = ? LIMIT 1',
    [id],
  );
  return row || null;
}

async function createAccount(userId, input) {
  await ensureSchema();
  const site = normalizeSite(input.site);
  const login = String(input.login || '').trim();
  const password = String(input.password || '');
  const telegramUsername = normalizeTg(input.telegram_username);
  const personaName = String(input.persona_name || '').trim().slice(0, 120);
  const personaPrompt = String(input.persona_prompt || '').trim();
  const language = String(input.language || 'en').toLowerCase().startsWith('ru')
    ? 'ru'
    : 'en';
  let inviteMin = Number(input.invite_after_min);
  let inviteMax = Number(input.invite_after_max);
  if (!Number.isFinite(inviteMin) || inviteMin < 60) inviteMin = 180;
  if (!Number.isFinite(inviteMax) || inviteMax < inviteMin) {
    inviteMax = Math.max(inviteMin, 240);
  }
  const telegramAccountId = input.telegram_account_id
    ? Number(input.telegram_account_id)
    : null;
  const dolphinProfileId = normalizeDolphinId(input.dolphin_profile_id);
  const isEnabled = input.is_enabled === false || input.is_enabled === 0 ? 0 : 1;

  if (!site) throw new Error('Неизвестный сайт');
  if (!login) throw new Error('Укажите логин / email сайта');
  if (!password) throw new Error('Укажите пароль от сайта');
  if (!telegramUsername) throw new Error('Укажите Telegram @username для инвайта');
  if (!isValidTgUsername(telegramUsername)) {
    throw new Error('Некорректный Telegram @username (5–32 символа, латиница/цифры/_)');
  }

  const [[dup]] = await db.execute(
    `SELECT id FROM dating_site_accounts
     WHERE user_id = ? AND site = ? AND login = ? LIMIT 1`,
    [userId, site, login],
  );
  if (dup) throw new Error('Такой логин на этом сайте уже подключён');

  if (telegramAccountId) {
    const [[own]] = await db.execute(
      'SELECT id FROM accounts WHERE id = ? AND user_id = ? LIMIT 1',
      [telegramAccountId, userId],
    );
    if (!own) throw new Error('Telegram-аккаунт не найден у вас');
  }

  const [result] = await db.execute(
    `INSERT INTO dating_site_accounts
      (user_id, site, login, password_enc, persona_name, persona_prompt,
       telegram_username, telegram_account_id, dolphin_profile_id, language,
       invite_after_min, invite_after_max, is_enabled, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle')`,
    [
      userId,
      site,
      login,
      password,
      personaName || telegramUsername,
      personaPrompt,
      telegramUsername,
      telegramAccountId,
      dolphinProfileId,
      language,
      inviteMin,
      inviteMax,
      isEnabled,
    ],
  );
  return getAccount(result.insertId);
}

async function updateAccount(id, patch, userId = null) {
  await ensureSchema();
  const existing = await getAccount(id, userId);
  if (!existing) throw new Error('Аккаунт не найден');

  const site =
    patch.site != null ? normalizeSite(patch.site) : existing.site;
  if (patch.site != null && !site) throw new Error('Неизвестный сайт');

  const login =
    patch.login != null ? String(patch.login).trim() : existing.login;
  const password =
    patch.password != null && String(patch.password).length > 0
      ? String(patch.password)
      : existing.password_enc;
  const telegramUsername =
    patch.telegram_username != null
      ? normalizeTg(patch.telegram_username)
      : existing.telegram_username;
  const personaName =
    patch.persona_name != null
      ? String(patch.persona_name).trim().slice(0, 120)
      : existing.persona_name;
  const personaPrompt =
    patch.persona_prompt != null
      ? String(patch.persona_prompt).trim()
      : existing.persona_prompt;
  const language =
    patch.language != null
      ? String(patch.language).toLowerCase().startsWith('ru')
        ? 'ru'
        : 'en'
      : existing.language;
  let inviteMin =
    patch.invite_after_min != null
      ? Number(patch.invite_after_min)
      : existing.invite_after_min;
  let inviteMax =
    patch.invite_after_max != null
      ? Number(patch.invite_after_max)
      : existing.invite_after_max;
  if (!Number.isFinite(inviteMin) || inviteMin < 60) inviteMin = 180;
  if (!Number.isFinite(inviteMax) || inviteMax < inviteMin) {
    inviteMax = Math.max(inviteMin, 240);
  }
  const telegramAccountId =
    patch.telegram_account_id === null || patch.telegram_account_id === ''
      ? null
      : patch.telegram_account_id != null
        ? Number(patch.telegram_account_id)
        : existing.telegram_account_id;
  const dolphinProfileId =
    patch.dolphin_profile_id === null || patch.dolphin_profile_id === ''
      ? null
      : patch.dolphin_profile_id != null
        ? normalizeDolphinId(patch.dolphin_profile_id)
        : existing.dolphin_profile_id;
  const isEnabled =
    patch.is_enabled === undefined
      ? existing.is_enabled
      : patch.is_enabled === false || patch.is_enabled === 0
        ? 0
        : 1;
  const status =
    patch.status != null ? String(patch.status).slice(0, 32) : existing.status;
  const lastError =
    patch.last_error === undefined
      ? existing.last_error
      : patch.last_error;

  if (!login || !telegramUsername) {
    throw new Error('Логин и Telegram обязательны');
  }
  if (!isValidTgUsername(telegramUsername)) {
    throw new Error('Некорректный Telegram @username (5–32 символа, латиница/цифры/_)');
  }

  await db.execute(
    `UPDATE dating_site_accounts SET
       site = ?, login = ?, password_enc = ?, persona_name = ?, persona_prompt = ?,
       telegram_username = ?, telegram_account_id = ?, dolphin_profile_id = ?, language = ?,
       invite_after_min = ?, invite_after_max = ?, is_enabled = ?,
       status = ?, last_error = ?
     WHERE id = ?`,
    [
      site,
      login,
      password,
      personaName,
      personaPrompt,
      telegramUsername,
      telegramAccountId,
      dolphinProfileId,
      language,
      inviteMin,
      inviteMax,
      isEnabled,
      status,
      lastError,
      id,
    ],
  );
  return getAccount(id);
}

async function deleteAccount(id, userId = null) {
  await ensureSchema();
  if (userId != null) {
    const [result] = await db.execute(
      'DELETE FROM dating_site_accounts WHERE id = ? AND user_id = ?',
      [id, userId],
    );
    return result.affectedRows > 0;
  }
  const [result] = await db.execute(
    'DELETE FROM dating_site_accounts WHERE id = ?',
    [id],
  );
  return result.affectedRows > 0;
}

async function exportWorker({ userId = null } = {}) {
  await ensureSchema();
  const rows = await listAccounts({
    userId: userId != null ? userId : undefined,
    enabledOnly: true,
  });
  // listAccounts with userId null lists all — for admin export of everything
  const filtered =
    (userId != null
      ? rows
      : rows.filter((r) => Number(r.is_enabled) === 1)
    ).filter((r) => String(r.site || '').toLowerCase() === 'tagged');

  const outDir = path.join(__dirname, '..', '..', 'tagged');
  fs.mkdirSync(outDir, { recursive: true });

  const payload = {
    exported_at: new Date().toISOString(),
    user_id: userId,
    chat_url: 'https://app.tagged.com/chats',
    invite: {
      after_seconds_min: filtered.length
        ? Math.min(...filtered.map((r) => Number(r.invite_after_min) || 180))
        : 180,
      after_seconds_max: filtered.length
        ? Math.max(...filtered.map((r) => Number(r.invite_after_max) || 240))
        : 240,
      max_invites_per_dialog: 2,
      cooldown_seconds: 120,
    },
    accounts: filtered.map((row) => ({
      id: `db_${row.id}`,
      db_id: row.id,
      enabled: Number(row.is_enabled) === 1,
      site: row.site,
      tagged_email: row.login,
      tagged_password: row.password_enc,
      persona_name: row.persona_name || row.telegram_username,
      persona_prompt: row.persona_prompt || '',
      telegram_username: row.telegram_username,
      telegram_display: `@${String(row.telegram_username || '').replace(/^@/, '')}`,
      language: row.language || 'en',
      invite_after_min: Number(row.invite_after_min) || 180,
      invite_after_max: Number(row.invite_after_max) || 240,
      telegram_account_id: row.telegram_account_id,
      dolphin_profile_id: row.dolphin_profile_id || null,
    })),
  };

  const outFile = path.join(outDir, 'accounts.from-db.json');
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');

  const alias = path.join(outDir, 'accounts.json');
  if (!fs.existsSync(alias)) {
    fs.writeFileSync(alias, JSON.stringify(payload, null, 2), 'utf8');
  } else {
    fs.writeFileSync(path.join(outDir, '.use-from-db'), '1\n', 'utf8');
  }

  return { count: payload.accounts.length, file: 'tagged/accounts.from-db.json' };
}

async function resolveUserIdByTelegram(telegramUserId) {
  const [[u]] = await db.execute(
    'SELECT id FROM users WHERE telegram_user_id = ? LIMIT 1',
    [String(telegramUserId)],
  );
  return u?.id || null;
}

module.exports = {
  SITES,
  ensureSchema,
  normalizeSite,
  normalizeTg,
  normalizeDolphinId,
  isValidTgUsername,
  publicRow,
  invitePhrase,
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  exportWorker,
  resolveUserIdByTelegram,
};
