const express = require('express');
const db = require('../db');
const { startLogin, confirmCode, confirmPassword, isActive } = require('../services/telegramClient');

const router = express.Router();
function getUserId(req) { return req.dbUser ? req.dbUser.id : 1; }

const ACCOUNTS_LIMIT = 10;

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
      `SELECT cm.account_id, cm.peer_id, cm.peer_username,
              COUNT(*) AS message_count,
              MAX(cm.created_at) AS last_at,
              a.phone AS account_phone
       FROM conversation_messages cm
       JOIN accounts a ON a.id = cm.account_id
       WHERE a.user_id = ?
       GROUP BY cm.account_id, cm.peer_id, cm.peer_username, a.phone
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
    const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
    const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';

    if (!phone) {
      return res.status(400).json({ success: false, error: 'Поле phone обязательно' });
    }

    const [[countRow]] = await db.execute(
      'SELECT COUNT(*) AS total FROM accounts WHERE user_id = ?',
      [getUserId(req)],
    );

    if (Number(countRow.total) >= ACCOUNTS_LIMIT) {
      return res.status(400).json({
        success: false,
        error: `Нельзя добавить больше ${ACCOUNTS_LIMIT} аккаунтов`,
      });
    }

    const [[existingAccount]] = await db.execute(
      'SELECT id FROM accounts WHERE user_id = ? AND phone = ? LIMIT 1',
      [getUserId(req), phone],
    );

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
    const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
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
    const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
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
    await saveSession(getUserId(req), phone, result.sessionString, prompt);
    return res.json({ success: true, status: 'connected' });
  } catch (error) {
    console.error('Connect code error:', error);
    return res.status(500).json({ success: false, error: 'Неверный код или ошибка входа' });
  }
});

// Шаг 3 (если включена 2FA): пользователь ввёл облачный пароль.
router.post('/connect/password', async (req, res) => {
  try {
    const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!phone || !password) {
      return res.status(400).json({ success: false, error: 'Нужны phone и password' });
    }

    const result = await confirmPassword(getUserId(req), phone, password);

    await saveSession(getUserId(req), phone, result.sessionString, prompt);
    return res.json({ success: true, status: 'connected' });
  } catch (error) {
    console.error('Connect password error:', error);
    return res.status(500).json({ success: false, error: 'Неверный пароль или ошибка входа' });
  }
});

// Временно только обновляем состояние аккаунта, без запуска настоящего AI.
router.post('/:id/start-ai', async (req, res) => {
  try {
    const [result] = await db.execute(
      `UPDATE accounts
       SET status = ?, is_autoreply_enabled = ?
       WHERE id = ? AND user_id = ?`,
      ['AI включен', true, req.params.id, getUserId(req)],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Аккаунт не найден' });
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

// Временно только останавливаем автоответы в базе данных.
router.post('/:id/stop-ai', async (req, res) => {
  try {
    const [result] = await db.execute(
      `UPDATE accounts
       SET status = ?, is_autoreply_enabled = ?
       WHERE id = ? AND user_id = ?`,
      ['Остановлен', false, req.params.id, getUserId(req)],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Аккаунт не найден' });
    }

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

// Ограничивает задержку рамками 1..60 секунд.
function clampDelay(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(60, Math.max(1, Math.round(n)));
}

// Обновить промпт (характер AI) и/или диапазон задержки ответа.
router.put('/:id', async (req, res) => {
  try {
    const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';

    // Ссылка на Telegram-чат с медиа (фото/видео/кружки). Пусто = выключено.
    const mediaChatLink =
      typeof req.body.mediaChatLink === 'string'
        ? req.body.mediaChatLink.trim().slice(0, 255)
        : '';

    // Диапазон задержки перед ответом (в секундах, 1..60).
    let delayMin = clampDelay(req.body.replyDelayMin, 3);
    let delayMax = clampDelay(req.body.replyDelayMax, 8);
    if (delayMin > delayMax) {
      [delayMin, delayMax] = [delayMax, delayMin];
    }

    const [result] = await db.execute(
      `UPDATE accounts
       SET prompt = ?, reply_delay_min = ?, reply_delay_max = ?, media_chat_link = ?
       WHERE id = ? AND user_id = ?`,
      [prompt, delayMin, delayMax, mediaChatLink, req.params.id, getUserId(req)],
    );

    if (result.affectedRows === 0) {
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

// Удалить только тот аккаунт, который принадлежит demo-пользователю.
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await db.execute(
      'DELETE FROM accounts WHERE id = ? AND user_id = ?',
      [req.params.id, getUserId(req)],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Аккаунт не найден' });
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
  const [[existing]] = await db.execute(
    'SELECT id FROM accounts WHERE user_id = ? AND phone = ? LIMIT 1',
    [userId, phone],
  );

  if (existing) {
    if (prompt) {
      await db.execute(
        'UPDATE accounts SET session_string = ?, status = ?, prompt = ? WHERE id = ? AND user_id = ?',
        [sessionString, 'Подключен', prompt, existing.id, userId],
      );
    } else {
      await db.execute(
        'UPDATE accounts SET session_string = ?, status = ? WHERE id = ? AND user_id = ?',
        [sessionString, 'Подключен', existing.id, userId],
      );
    }
  } else {
    await db.execute(
      `INSERT INTO accounts (user_id, phone, session_string, status, is_autoreply_enabled, prompt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, phone, sessionString, 'Подключен', false, prompt || ''],
    );
  }
}

module.exports = router;
