const crypto = require('crypto');
const pool = require('../db'); // путь поправь, если db.js лежит в другом месте

const DEV_BYPASS = process.env.TELEGRAM_AUTH_BYPASS === 'true';

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
    .digest('hex');

  if (calculatedHash !== hash) return null;

  const authDate = Number(params.get('auth_date'));
  if (authDate) {
    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
    if (ageSeconds > 86400) return null;
  }

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

  // Пытаемся найти существующего пользователя
  const [rows] = await pool.query(
    'SELECT * FROM users WHERE telegram_user_id = ? LIMIT 1',
    [telegramId],
  );

  if (rows.length > 0) {
    return rows[0];
  }

  // Не нашли — создаём нового (balance, account_limit, created_at заполнятся по умолчанию)
  const [result] = await pool.query(
    'INSERT INTO users (telegram_user_id, username, first_name) VALUES (?, ?, ?)',
    [telegramId, username, firstName],
  );

  const [newRows] = await pool.query(
    'SELECT * FROM users WHERE id = ? LIMIT 1',
    [result.insertId],
  );

  return newRows[0];
}

/**
 * Express-middleware: проверяет заголовок X-Telegram-Init-Data,
 * находит/создаёт пользователя в БД и кладёт его в req.dbUser.
 */
module.exports = async function telegramAuth(req, res, next) {
  // Health-check пропускаем без авторизации
  if (req.path === '/api/health') return next();

  try {
    const initData = req.header('X-Telegram-Init-Data');

    let tgUser;

    if (DEV_BYPASS && !initData) {
      // Режим разработки: фиктивный пользователь Telegram
      tgUser = { id: 999999999, first_name: 'Dev', username: 'dev' };
    } else {
      const botToken = process.env.BOT_TOKEN;
      tgUser = validateInitData(initData, botToken);

      if (!tgUser) {
        return res.status(401).json({ error: 'Недействительные данные Telegram' });
      }
    }

    // Находим или создаём пользователя в базе
    const dbUser = await findOrCreateUser(tgUser);

    req.telegramUser = tgUser; // сырые данные из Telegram
    req.dbUser = dbUser;       // запись из таблицы users (id, balance, account_limit...)

    next();
  } catch (error) {
    console.error('telegramAuth error:', error);
    res.status(500).json({ error: 'Ошибка авторизации' });
  }
};