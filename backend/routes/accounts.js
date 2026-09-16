const express = require('express');
const db = require('../db');
const { startLogin, confirmCode, confirmPassword, isActive, activateAccount, deactivateAccount } = require('../services/telegramClient');
const { purgeAccount } = require('../services/accountCleanup');

const router = express.Router();
function getUserId(req) { return req.dbUser ? req.dbUser.id : 1; }

// iPhone вставляет номер как «+7 958 738 14 82» или «8 (958) 738-14-82».
// Telegram принимает только цифры с плюсом, иначе код не уходит.
function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return `+${digits}`;
}

function readPhone(raw) {
  const phone = normalizePhone(raw);
  return phone.length >= 11 ? phone : '';
}

async function ownedAccount(req, id) {
  const [[row]] = await db.execute(
    'SELECT id, session_string FROM accounts WHERE id = ? AND user_id = ? LIMIT 1',
    [id, getUserId(req)],
  );
  return row || null;
}

async function connectOwnedAccount(account) {
  if (isActive(account.id)) return true;
  if (!account.session_string) return false;
  const online = await activateAccount(account.id, account.session_string);
  if (online === 'revoked') {
    const error = new Error('Сессия отозвана, аккаунт удалён из базы');
    error.statusCode = 410;
    throw error;
  }
  return online === true;
}

async function getAccountLimit(userId) {
  const [[user]] = await db.execute(
    'SELECT account_limit FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  const limit = Number(user?.account_limit);
  return Number.isFinite(limit) && limit > 0 ? limit : 10;
}

// Получить все аккаунты текущего demo-пользователя.
router.get('/', async (req, res) => {
  try {
    const [accounts] = await db.execute(
      `SELECT id, phone, prompt, status, is_autoreply_enabled,
              reply_delay_min, reply_delay_max, media_chat_link,
              created_at, updated_at
       FROM accounts
       WHERE user_id = ?
       ORDER BY id DESC`,
      [getUserId(req)],
    );

    // is_online = аккаунт РЕАЛЬНО подключён в текущем процессе (живой клиент
    // в памяти, слушает входящие). Отличается от is_autoreply_enabled — это
    // настройка в БД, которая может быть включена, но клиент ещё не поднят.
    const withOnline = accounts.map((account) => ({
      ...account,
      is_online: isActive(account.id),
    }));

    res.json({ success: true, accounts: withOnline });
  } catch (error) {
    console.error('Get accounts error:', error);
    res.status(500).json({ success: false, error: 'Не удалось получить аккаунты' });
  }
});

// --- Диалоги (история переписок) ---
// ВАЖНО: эти маршруты объявлены ВЫШЕ '/:id', чтобы путь '/conversations'
// не перехватывался параметрическим маршрутом.

// Список диалогов пользователя, сгруппированных по собеседнику.
router.get('/conversations', async (req, res) => {
  try {
    const userId = getUserId(req);

    const [rows] = await db.execute(
      `SELECT cm.account_id, cm.peer_id,
              MAX(cm.peer_username) AS peer_username,
              COUNT(*) AS message_count,
              MAX(cm.created_at) AS last_at,
              MAX(a.phone) AS account_phone
       FROM conversation_messages cm
       JOIN accounts a ON a.id = cm.account_id
       WHERE a.user_id = ?
       GROUP BY cm.account_id, cm.peer_id
       ORDER BY last_at DESC`,
      [userId],
    );

    res.json({ success: true, conversations: rows });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ success: false, error: 'Не удалось получить диалоги' });
  }
});

// Стереть историю переписки с конкретным собеседником.
router.delete('/conversations/:accountId/:peerId', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { accountId, peerId } = req.params;

    // Проверяем, что аккаунт принадлежит текущему пользователю.
    const [[account]] = await db.execute(
      'SELECT id FROM accounts WHERE id = ? AND user_id = ? LIMIT 1',
      [accountId, userId],
    );

    if (!account) {
      return res.status(404).json({ success: false, error: 'Аккаунт не найден' });
    }

    await db.execute(
      'DELETE FROM conversation_messages WHERE account_id = ? AND peer_id = ?',
      [accountId, peerId],
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({ success: false, error: 'Не удалось стереть историю' });
  }
});

// Добавить аккаунт. Подключение к Telegram появится на следующем этапе.
router.post('/', async (req, res) => {
  try {
    const phone = readPhone(req.body.phone);
    const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';

    if (!phone) {
      return res.status(400).json({ success: false, error: 'Поле phone обязательно' });
    }

    const [[countRow]] = await db.execute(
      'SELECT COUNT(*) AS total FROM accounts WHERE user_id = ?',
      [getUserId(req)],
    );

    const limit = await getAccountLimit(getUserId(req));
    if (Number(countRow.total) >= limit) {
      return res.status(400).json({
        success: false,
        error: `Нельзя добавить больше ${limit} аккаунтов`,
      });
    }

    const [owned] = await db.execute(
      'SELECT id, phone FROM accounts WHERE user_id = ?',
      [getUserId(req)],
    );
    const existingAccount = owned.find((row) => normalizePhone(row.phone) === phone);

    if (existingAccount) {
      return res.status(409).json({
        success: false,
        error: 'Аккаунт с таким телефоном уже добавлен',
      });
    }

    const [result] = await db.execute(
      `INSERT INTO accounts (user_id, phone, prompt, status, is_autoreply_enabled)
       VALUES (?, ?, ?, ?, ?)`,
      [getUserId(req), phone, prompt, 'Остановлен', false],
    );

    const [[account]] = await db.execute(
      `SELECT id, phone, prompt, status, is_autoreply_enabled, created_at, updated_at
       FROM accounts
       WHERE id = ? AND user_id = ?`,
      [result.insertId, getUserId(req)],
    );

    return res.status(201).json({ success: true, account });
  } catch (error) {
    console.error('Create account error:', error);

    // Уникальный индекс в БД дополнительно защищает от одновременного добавления дублей.
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        error: 'Аккаунт с таким телефоном уже добавлен',
      });
    }

    return res.status(500).json({ success: false, error: 'Не удалось добавить аккаунт' });
  }
});

// --- Подключение Telegram-аккаунта через GramJS (многошаговый вход) ---

// Шаг 1: пользователь ввёл телефон -> просим Telegram отправить код.
router.post('/connect/start', async (req, res) => {
  try {
    const phone = readPhone(req.body.phone);
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Поле phone обязательно' });
    }

    await startLogin(getUserId(req), phone);
    return res.json({ success: true, status: 'codeSent' });
  } catch (error) {
    console.error('Connect start error:', error);
    return res.status(500).json({ success: false, error: 'Не удалось отправить код' });
  }
});

// Шаг 2: пользователь ввёл код из Telegram.
router.post('/connect/code', async (req, res) => {
  try {
    const phone = readPhone(req.body.phone);
    const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
    const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!phone || !code) {
      return res.status(400).json({ success: false, error: 'Нужны phone и code' });
    }

    const result = await confirmCode(getUserId(req), phone, code);

    // Требуется облачный пароль (2FA)
    if (result.status === 'needPassword') {
      return res.json({ success: true, status: 'needPassword' });
    }

    // Успех -> сохраняем session_string (и промпт) в базу
    const accountId = await saveSession(getUserId(req), phone, result.sessionString, prompt);
    await deactivateAccount(accountId);
    const online = (await activateAccount(accountId, result.sessionString)) === true;
    return res.json({ success: true, status: 'connected', is_online: online });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    console.error('Connect code error:', error);
    return res.status(500).json({ success: false, error: 'Неверный код или ошибка входа' });
  }
});

// Шаг 3 (если включена 2FA): пользователь ввёл облачный пароль.
router.post('/connect/password', async (req, res) => {
  try {
    const phone = readPhone(req.body.phone);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!phone || !password) {
      return res.status(400).json({ success: false, error: 'Нужны phone и password' });
    }

    const result = await confirmPassword(getUserId(req), phone, password);

    const accountId = await saveSession(getUserId(req), phone, result.sessionString, prompt);
    await deactivateAccount(accountId);
    const online = (await activateAccount(accountId, result.sessionString)) === true;
    return res.json({ success: true, status: 'connected', is_online: online });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    console.error('Connect password error:', error);
    return res.status(500).json({ success: false, error: 'Неверный пароль или ошибка входа' });
  }
});

// Массовое управление автоответами для всех аккаунтов текущего пользователя.
router.post('/bulk/start-ai', async (req, res) => {
  try {
    const [result] = await db.execute(
      `UPDATE accounts
       SET status = 'AI включен', is_autoreply_enabled = TRUE
       WHERE user_id = ?`,
      [getUserId(req)],
    );
    const [accounts] = await db.execute(
      `SELECT id, session_string
       FROM accounts
       WHERE user_id = ? AND is_autoreply_enabled = TRUE`,
      [getUserId(req)],
    );
    let offline = 0;
    for (const account of accounts) {
      if (!(await connectOwnedAccount(account))) offline += 1;
    }
    if (offline > 0) {
      return res.status(503).json({
        success: false,
        error: `AI включён, но не подключилось сессий: ${offline}`,
      });
    }
    return res.json({ success: true, affectedRows: result.affectedRows, is_autoreply_enabled: true });
  } catch (error) {
    console.error('Bulk start AI error:', error);
    return res.status(500).json({ success: false, error: 'Не удалось включить AI на аккаунтах' });
  }
});

router.post('/bulk/stop-ai', async (req, res) => {
  try {
    const [result] = await db.execute(
      `UPDATE accounts
       SET status = 'Остановлен', is_autoreply_enabled = FALSE
       WHERE user_id = ?`,
      [getUserId(req)],
    );
    return res.json({ success: true, affectedRows: result.affectedRows, is_autoreply_enabled: false });
  } catch (error) {
    console.error('Bulk stop AI error:', error);
    return res.status(500).json({ success: false, error: 'Не удалось выключить AI на аккаунтах' });
  }
});

router.post('/:id/start-ai', async (req, res) => {
  try {
    const account = await ownedAccount(req, req.params.id);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Аккаунт не найден' });
    }

    await db.execute(
      `UPDATE accounts
       SET status = ?, is_autoreply_enabled = ?
       WHERE id = ? AND user_id = ?`,
      ['AI включен', true, req.params.id, getUserId(req)],
    );

    if (!(await connectOwnedAccount(account))) {
      return res.status(503).json({
        success: false,
        error: 'AI включён, но сессия не подключилась',
      });
    }

    return res.json({
      success: true,
      status: 'AI включен',
      is_autoreply_enabled: true,
    });
  } catch (error) {
    console.error('Start AI error:', error);
    return res.status(500).json({ success: false, error: 'Не удалось включить AI' });
  }
});

router.post('/:id/stop-ai', async (req, res) => {
  try {
    const account = await ownedAccount(req, req.params.id);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Аккаунт не найден' });
    }

    await db.execute(
      `UPDATE accounts
       SET status = ?, is_autoreply_enabled = ?
       WHERE id = ? AND user_id = ?`,
      ['Остановлен', false, req.params.id, getUserId(req)],
    );

    return res.json({
      success: true,
      status: 'Остановлен',
      is_autoreply_enabled: false,
    });
  } catch (error) {
    console.error('Stop AI error:', error);
    return res.status(500).json({ success: false, error: 'Не удалось остановить AI' });
  }
});

// Задержка только из карточки аккаунта. 8..90 секунд, как в ответе бота.
function clampDelay(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(90, Math.max(8, Math.round(n)));
}

// Обновить промпт (характер AI) и/или диапазон задержки ответа.
router.put('/:id', async (req, res) => {
  try {
    const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';

    // Ссылка на Telegram-чат с медиа (фото/видео/кружки). Пусто = выключено.
    const rawMediaChatLink =
      typeof req.body.mediaChatLink === 'string'
        ? req.body.mediaChatLink.trim()
        : '';
    const mediaChatLink = rawMediaChatLink.slice(0, 255);

    if (
      mediaChatLink &&
      !mediaChatLink.startsWith('@') &&
      !mediaChatLink.startsWith('+') &&
      !/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\//i.test(mediaChatLink)
    ) {
      return res.status(400).json({
        success: false,
        error: 'Укажите ссылку t.me/telegram.me, @username или приватную ссылку +hash',
      });
    }

    // Диапазон задержки перед ответом (в секундах, 1..60).
    let delayMin = clampDelay(req.body.replyDelayMin, 25);
    let delayMax = clampDelay(req.body.replyDelayMax, 50);
    if (delayMin > delayMax) {
      [delayMin, delayMax] = [delayMax, delayMin];
    }

    await db.execute(
      `UPDATE accounts
       SET prompt = ?, reply_delay_min = ?, reply_delay_max = ?, media_chat_link = ?
       WHERE id = ? AND user_id = ?`,
      [prompt, delayMin, delayMax, mediaChatLink, req.params.id, getUserId(req)],
    );

    const account = await ownedAccount(req, req.params.id);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Аккаунт не найден' });
    }

    return res.json({
      success: true,
      prompt,
      reply_delay_min: delayMin,
      reply_delay_max: delayMax,
      media_chat_link: mediaChatLink,
    });
  } catch (error) {
    console.error('Update prompt error:', error);
    return res.status(500).json({ success: false, error: 'Не удалось сохранить настройки' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const account = await ownedAccount(req, req.params.id);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Аккаунт не найден' });
    }

    await deactivateAccount(req.params.id);
    const removed = await purgeAccount(req.params.id, getUserId(req));
    if (!removed) {
      return res.status(500).json({ success: false, error: 'Не удалось удалить аккаунт из базы' });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete account error:', error);
    return res.status(500).json({ success: false, error: 'Не удалось удалить аккаунт' });
  }
});

// Сохраняет session_string: обновляет существующий аккаунт или создаёт новый.
// prompt сохраняется только если он передан (не пустой), чтобы не затирать
// уже заданный промпт при повторном подключении.
async function saveSession(userId, phone, sessionString, prompt = '') {
  const [owned] = await db.execute(
    'SELECT id, phone FROM accounts WHERE user_id = ?',
    [userId],
  );
  const existing = owned.find((row) => normalizePhone(row.phone) === phone);

  if (existing) {
    if (prompt) {
      await db.execute(
        'UPDATE accounts SET phone = ?, session_string = ?, status = ?, prompt = ? WHERE id = ? AND user_id = ?',
        [phone, sessionString, 'Подключен', prompt, existing.id, userId],
      );
    } else {
      await db.execute(
        'UPDATE accounts SET phone = ?, session_string = ?, status = ? WHERE id = ? AND user_id = ?',
        [phone, sessionString, 'Подключен', existing.id, userId],
      );
    }
    return existing.id;
  }

  const limit = await getAccountLimit(userId);
  const [[countRow]] = await db.execute(
    'SELECT COUNT(*) AS total FROM accounts WHERE user_id = ?',
    [userId],
  );
  if (Number(countRow.total) >= limit) {
    const error = new Error(`Нельзя добавить больше ${limit} аккаунтов`);
    error.statusCode = 400;
    throw error;
  }

  const [result] = await db.execute(
    `INSERT INTO accounts (user_id, phone, session_string, status, is_autoreply_enabled, prompt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, phone, sessionString, 'Подключен', false, prompt || ''],
  );
  return result.insertId;
}

module.exports = router;
