const crypto = require('crypto');
const pool = require('../db');

/**
 * Bypass без initData разрешён только:
 *  - NODE_ENV=development|dev|test + TELEGRAM_AUTH_BYPASS=true
 *  - или TELEGRAM_AUTH_BYPASS_FORCE=true + X-Auth-Bypass-Key + socket-loopback
 *    (ключ без loopback не пускает — remote не обходит initData даже с ключом)
 * Loopback смотрим ТОЛЬКО по socket.remoteAddress — не req.ip / X-Forwarded-For
 * (trust proxy иначе делает 127.0.0.1 поддельным).
 */
function socketRemoteAddress(req) {
  return String(
    req.socket?.remoteAddress ||
      req.connection?.remoteAddress ||
      '',
  );
}

function isLoopback(req) {
  const raw = socketRemoteAddress(req);
  return (
    raw === '127.0.0.1' ||
    raw === '::1' ||
    raw === '::ffff:127.0.0.1' ||
    raw.endsWith('127.0.0.1')
  );
}

function allowAuthBypass(req) {
  if (process.env.TELEGRAM_AUTH_BYPASS !== 'true') return false;
  const env = String(process.env.NODE_ENV || 'production').toLowerCase();
  if (env === 'development' || env === 'dev' || env === 'test') return true;
  if (process.env.TELEGRAM_AUTH_BYPASS_FORCE !== 'true') return false;
  const key = String(process.env.TELEGRAM_AUTH_BYPASS_KEY || '').trim();
  // FORCE: и ключ, и socket-loopback. Ключ один на VPS не открывает API снаружи.
  if (!key) return false;
  if (req.header('X-Auth-Bypass-Key') !== key) return false;
  return isLoopback(req);
}

/**
 * Проверяет подпись initData по алгоритму Telegram.
 * Возвращает объект пользователя Telegram, если подпись верна, иначе null.
 */
function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest();
  let given;
  try {
    given = Buffer.from(String(hash), 'hex');
  } catch {
    return null;
  }
  if (
    given.length !== calculatedHash.length ||
    !crypto.timingSafeEqual(calculatedHash, given)
  ) {
    return null;
  }

  const authDate = Number(params.get('auth_date'));
  // Без auth_date initData не принимаем (replay без timestamp).
  if (!authDate || !Number.isFinite(authDate)) return null;
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  // Replay window 2ч (раньше 24ч — слишком долго при утечке initData).
  if (ageSeconds > 7200 || ageSeconds < -120) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;

  try {
    return JSON.parse(userRaw);
  } catch {
    return null;
  }
}

/**
 * Находит пользователя в БД по telegram_user_id.
 * Если его нет — создаёт. Возвращает запись из таблицы users.
 */
async function findOrCreateUser(tgUser) {
  const telegramId = tgUser.id;
  const username = tgUser.username || null;
  const firstName = tgUser.first_name || null;

  const [rows] = await pool.query(
    'SELECT * FROM users WHERE telegram_user_id = ? LIMIT 1',
    [telegramId],
  );

  if (rows.length > 0) {
    const user = rows[0];
    if ((username && user.username !== username) || (firstName && user.first_name !== firstName)) {
      await pool.query('UPDATE users SET username = ?, first_name = ? WHERE id = ?', [
        username || user.username,
        firstName || user.first_name,
        user.id,
      ]);
      user.username = username || user.username;
      user.first_name = firstName || user.first_name;
    }
    return user;
  }

  await pool.query(
    `INSERT INTO users (telegram_user_id, username, first_name) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE telegram_user_id = telegram_user_id`,
    [telegramId, username, firstName],
  );

  const [newRows] = await pool.query(
    'SELECT * FROM users WHERE telegram_user_id = ? LIMIT 1',
    [telegramId],
  );

  return newRows[0];
}

/**
 * Express-middleware: проверяет заголовок X-Telegram-Init-Data,
 * находит/создаёт пользователя в БД и кладёт его в req.dbUser.
 */
/** Простой rate-limit неудачных / частых попыток console-токена (по IP). */
const consoleTokenHits = new Map();
function consoleTokenRateOk(req) {
  const ip = socketRemoteAddress(req) || req.ip || 'unknown';
  const now = Date.now();
  let b = consoleTokenHits.get(ip);
  if (!b || now - b.start > 60_000) {
    b = { start: now, n: 0, fail: 0 };
    consoleTokenHits.set(ip, b);
  }
  b.n += 1;
  if (b.n > 120) return false;
  if (b.fail > 30) return false;
  return true;
}
function consoleTokenMarkFail(req) {
  const ip = socketRemoteAddress(req) || req.ip || 'unknown';
  const b = consoleTokenHits.get(ip);
  if (b) b.fail += 1;
}

function adminConsoleTokenOk(req) {
  const expected = String(process.env.ADMIN_CONSOLE_TOKEN || '').trim();
  if (!expected || expected.length < 16) return false;
  const got = String(
    req.header('X-Admin-Console-Token') || req.header('x-admin-console-token') || '',
  ).trim();
  if (!got || got.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  } catch {
    return false;
  }
}

module.exports = async function telegramAuth(req, res, next) {
  if (req.path === '/api/health') return next();

  // Десктоп-консоль (Win/Mac): только /api/admin/console + валидный токен.
  const isConsolePath =
    req.path === '/api/admin/console' || req.path.startsWith('/api/admin/console/');
  if (isConsolePath) {
    const hasHeader = Boolean(
      req.header('X-Admin-Console-Token') || req.header('x-admin-console-token'),
    );
    if (hasHeader) {
      if (!consoleTokenRateOk(req)) {
        return res.status(429).json({ error: 'Слишком много запросов' });
      }
      if (adminConsoleTokenOk(req)) {
        req.adminConsoleAuth = true;
        return next();
      }
      consoleTokenMarkFail(req);
      return res.status(401).json({ error: 'Неверный ключ консоли' });
    }
  }

  try {
    const initData = req.header('X-Telegram-Init-Data');

    let tgUser;

    if (!initData && allowAuthBypass(req)) {
      const bypassAs = Number(
        process.env.TELEGRAM_AUTH_BYPASS_AS ||
          process.env.ADMIN_ALERT_CHAT_ID ||
          999999999,
      );
      tgUser = {
        id: bypassAs,
        first_name: 'DevBypass',
        username: 'dev_bypass',
      };
      console.warn(
        `[telegramAuth] bypass без initData → telegram_user_id=${bypassAs} socket=${socketRemoteAddress(req) || '?'}`,
      );
    } else {
      const botToken = process.env.BOT_TOKEN;
      tgUser = validateInitData(initData, botToken);

      if (!tgUser) {
        return res.status(401).json({ error: 'Недействительные данные Telegram' });
      }
    }

    const dbUser = await findOrCreateUser(tgUser);
    if (Number(dbUser.is_blocked) === 1) {
      return res.status(403).json({ error: 'Доступ закрыт' });
    }

    req.telegramUser = tgUser;
    req.dbUser = dbUser;

    next();
  } catch (error) {
    console.error('telegramAuth error:', error);
    res.status(500).json({ error: 'Ошибка авторизации' });
  }
};

module.exports.allowAuthBypass = allowAuthBypass;
module.exports.validateInitData = validateInitData;
module.exports.isLoopback = isLoopback;
module.exports.socketRemoteAddress = socketRemoteAddress;
module.exports.adminConsoleTokenOk = adminConsoleTokenOk;
