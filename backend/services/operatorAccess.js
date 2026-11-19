/**
 * Роли операторов (тестер / админ), управляемые из /menu.
 *
 * Источники доступа (OR):
 *   1) ADMIN_ALERT_CHAT_ID — суперадмин (только numeric ID, нельзя снять)
 *   2) .env BETA_TESTER_* — запасной список тестеров
 *   3) таблица operator_roles — живое управление из бота (нужен telegram_user_id)
 *
 * Роли:
 *   tester — расширенный доступ к miniapp API
 *   admin  — полный /menu + бета-фичи
 */

const db = require('../db');

const SUPER_ADMIN_ID = String(process.env.ADMIN_ALERT_CHAT_ID || '').trim();
/** Только display / резолв имени в UI — НЕ для elevation без ID. */
const SUPER_ADMIN_USERNAME = normalizeUsernameStatic(
  process.env.ADMIN_ALERT_USERNAME || '',
);
if (!SUPER_ADMIN_ID) {
  console.warn(
    '[operatorAccess] ADMIN_ALERT_CHAT_ID не задан — суперадмин из env недоступен (fail-closed).',
  );
}
if (SUPER_ADMIN_USERNAME && !SUPER_ADMIN_ID) {
  console.warn(
    '[operatorAccess] ADMIN_ALERT_USERNAME задан без CHAT_ID — username-elevation отключён.',
  );
}

let schemaReady = false;
/** @type {{ ids: Set<string>, usernames: Set<string>, loadedAt: number } | null} */
let cache = null;
/** @type {string | null} */
let superAdminUsernameCache = null;
let superAdminUsernameAt = 0;
const CACHE_TTL_MS = 15_000;

function normalizeUsernameStatic(value) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

function parseIdList(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeUsername(value) {
  return normalizeUsernameStatic(value);
}

async function resolveSuperAdminUsername() {
  if (!SUPER_ADMIN_ID) return SUPER_ADMIN_USERNAME || null;
  const now = Date.now();
  if (superAdminUsernameCache && now - superAdminUsernameAt < CACHE_TTL_MS) {
    return superAdminUsernameCache;
  }
  try {
    const [[row]] = await db.execute(
      'SELECT username FROM users WHERE telegram_user_id = ? LIMIT 1',
      [SUPER_ADMIN_ID],
    );
    const fromDb = normalizeUsername(row?.username);
    superAdminUsernameCache = fromDb || SUPER_ADMIN_USERNAME || null;
  } catch (_) {
    superAdminUsernameCache = SUPER_ADMIN_USERNAME || null;
  }
  superAdminUsernameAt = now;
  return superAdminUsernameCache;
}

async function ensureSchema() {
  if (schemaReady) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS operator_roles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      telegram_user_id BIGINT NULL,
      username VARCHAR(64) NULL,
      role ENUM('tester','admin') NOT NULL DEFAULT 'tester',
      note VARCHAR(255) NULL,
      created_by BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_op_tg (telegram_user_id),
      UNIQUE KEY uq_op_user (username),
      INDEX idx_op_role (role)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  schemaReady = true;
}

function invalidateCache() {
  cache = null;
}

async function loadDbRoles() {
  await ensureSchema();
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache;

  const [rows] = await db.execute(
    `SELECT telegram_user_id, username, role FROM operator_roles`,
  );
  const testerIds = new Set();
  const testerNames = new Set();
  const adminIds = new Set();
  const adminNames = new Set();

  for (const r of rows) {
    const id = r.telegram_user_id != null ? String(r.telegram_user_id) : '';
    const name = normalizeUsername(r.username);
    // Elevation только по numeric ID. Username — display / legacy lookup.
    if (r.role === 'admin') {
      if (id) {
        adminIds.add(id);
        testerIds.add(id);
      }
      if (name) {
        adminNames.add(name);
        testerNames.add(name);
      }
    } else if (id) {
      testerIds.add(id);
      if (name) testerNames.add(name);
    } else if (name) {
      // username-only row: не даёт admin/tester через isAdmin/isBeta (см. sync checks).
      testerNames.add(name);
    }
  }

  cache = {
    testerIds,
    testerNames,
    adminIds,
    adminNames,
    rows,
    loadedAt: now,
  };
  return cache;
}

function envTesterIds() {
  const fromEnv = parseIdList(process.env.BETA_TESTER_TELEGRAM_IDS);
  const ids = new Set(fromEnv);
  if (SUPER_ADMIN_ID) ids.add(SUPER_ADMIN_ID);
  return ids;
}

function envTesterUsernames() {
  return new Set(parseIdList(process.env.BETA_TESTER_USERNAMES).map(normalizeUsername));
}

/** Суперадмин — только по numeric Telegram ID. */
function isSuperAdmin(telegramUserId, _username) {
  if (!SUPER_ADMIN_ID) return false;
  return String(telegramUserId || '') === SUPER_ADMIN_ID;
}

/** Sync-проверка админа по кэшу (для /menu hot path). Только ID. */
function isAdminSync(telegramUserId, username) {
  if (isSuperAdmin(telegramUserId, username)) return true;
  if (!cache) return false;
  const id = String(telegramUserId || '');
  if (id && cache.adminIds.has(id)) return true;
  return false;
}

/**
 * Полный доступ к /menu.
 */
async function isAdmin(telegramUserId, username) {
  await loadDbRoles();
  await resolveSuperAdminUsername();
  return isAdminSync(telegramUserId, username);
}

/**
 * Синхронная проверка по уже загруженному кэшу / env — для hot path.
 * Admin/tester из БД — по ID. Env BETA_TESTER_USERNAMES — legacy (только tester).
 */
function isBetaTesterSync(user) {
  if (!user) return false;
  const tgId = String(user.telegram_user_id || user.telegramUserId || '');
  const uname = normalizeUsername(user.username);

  if (isSuperAdmin(tgId, uname)) return true;
  if (tgId && envTesterIds().has(tgId)) return true;
  // BETA_TESTER_USERNAMES больше не elevатит — только numeric IDs.

  if (cache) {
    if (tgId && (cache.testerIds.has(tgId) || cache.adminIds.has(tgId))) return true;
  }
  return false;
}

async function isBetaTester(user) {
  if (!user) return false;
  await loadDbRoles();
  return isBetaTesterSync(user);
}

async function isAdminChat(chatId, username) {
  return isAdmin(chatId, username);
}

async function listOperators() {
  await ensureSchema();
  const [rows] = await db.execute(
    `SELECT id, telegram_user_id, username, role, note, created_at
     FROM operator_roles
     ORDER BY role DESC, id ASC`,
  );
  return rows;
}

/**
 * Добавить / обновить роль. Обязателен telegram_user_id.
 */
async function upsertOperator({
  telegramUserId = null,
  username = null,
  role = 'tester',
  note = null,
  createdBy = null,
} = {}) {
  await ensureSchema();
  const r = role === 'admin' ? 'admin' : 'tester';
  const tgId = telegramUserId != null && String(telegramUserId).trim()
    ? String(telegramUserId).trim()
    : null;
  const uname = normalizeUsername(username) || null;

  if (!tgId) {
    throw new Error('Нужен числовой Telegram ID (username alone больше не принимаем)');
  }
  if (!/^\d{5,15}$/.test(tgId)) throw new Error('Некорректный Telegram ID');
  if (uname && !/^[a-z0-9_]{3,32}$/.test(uname)) {
    throw new Error('Некорректный @username');
  }
  if (isSuperAdmin(tgId)) {
    throw new Error('Суперадмин уже встроен — отдельно добавлять не нужно');
  }

  let existing = null;
  const [[byId]] = await db.execute(
    'SELECT * FROM operator_roles WHERE telegram_user_id = ? LIMIT 1',
    [tgId],
  );
  existing = byId || null;
  if (!existing && uname) {
    const [[byName]] = await db.execute(
      'SELECT * FROM operator_roles WHERE LOWER(username) = ? LIMIT 1',
      [uname],
    );
    existing = byName || null;
  }

  if (existing) {
    await db.execute(
      `UPDATE operator_roles
       SET telegram_user_id = ?,
           username = COALESCE(?, username),
           role = ?,
           note = COALESCE(?, note)
       WHERE id = ?`,
      [tgId, uname, r, note, existing.id],
    );
    invalidateCache();
    const [[row]] = await db.execute(
      'SELECT * FROM operator_roles WHERE id = ? LIMIT 1',
      [existing.id],
    );
    return { row, created: false };
  }

  const [result] = await db.execute(
    `INSERT INTO operator_roles (telegram_user_id, username, role, note, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [tgId, uname, r, note, createdBy],
  );
  invalidateCache();
  const [[row]] = await db.execute(
    'SELECT * FROM operator_roles WHERE id = ? LIMIT 1',
    [result.insertId],
  );
  return { row, created: true };
}

async function removeOperator(id) {
  await ensureSchema();
  const [[row]] = await db.execute(
    'SELECT * FROM operator_roles WHERE id = ? LIMIT 1',
    [id],
  );
  if (!row) return false;
  if (row.telegram_user_id && isSuperAdmin(row.telegram_user_id)) {
    throw new Error('Суперадмина нельзя удалить');
  }
  await db.execute('DELETE FROM operator_roles WHERE id = ?', [id]);
  invalidateCache();
  return true;
}

async function removeByTelegramId(telegramUserId) {
  await ensureSchema();
  if (isSuperAdmin(telegramUserId)) throw new Error('Суперадмина нельзя удалить');
  const [result] = await db.execute(
    'DELETE FROM operator_roles WHERE telegram_user_id = ?',
    [String(telegramUserId)],
  );
  invalidateCache();
  return result.affectedRows > 0;
}

module.exports = {
  SUPER_ADMIN_ID,
  SUPER_ADMIN_USERNAME,
  ensureSchema,
  invalidateCache,
  isSuperAdmin,
  isAdmin,
  isAdminSync,
  isAdminChat,
  isBetaTester,
  isBetaTesterSync,
  listOperators,
  upsertOperator,
  removeOperator,
  removeByTelegramId,
  normalizeUsername,
  resolveSuperAdminUsername,
  envTesterIds,
  envTesterUsernames,
};
