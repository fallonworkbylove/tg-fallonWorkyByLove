const express = require('express');
const db = require('../db');
const {
  startLogin,
  resendLoginCode,
  confirmCode,
  confirmPassword,
  isActive,
  activateAccount,
  deactivateAccount,
  scanUnansweredDialogs,
} = require('../services/telegramClient');
const { purgeAccount } = require('../services/accountCleanup');
const leadScoring = require('../services/leadScoring');

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

/** Начало календарных суток по Москве (UTC+3), как в adminMenu. */
function sqlMskDayStart(daysAgo = 0) {
  const d = Math.max(0, Number(daysAgo) || 0);
  return (
    `DATE_ADD(DATE_ADD(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR)), ` +
    `INTERVAL -${d} DAY), INTERVAL -3 HOUR)`
  );
}

// Получить все аккаунты текущего demo-пользователя.
router.get('/', async (req, res) => {
  try {
    const dayStart = sqlMskDayStart(0);
    const [accounts] = await db.execute(
      `SELECT a.id, a.phone, a.prompt, a.status, a.is_autoreply_enabled,
              a.reply_delay_min, a.reply_delay_max, a.media_chat_link,
              a.created_at, a.updated_at,
              (SELECT COUNT(*) FROM conversation_messages m
                WHERE m.account_id = a.id AND m.role = 'assistant'
                  AND m.created_at >= ${dayStart}) AS sent_today
       FROM accounts a
       WHERE a.user_id = ?
       ORDER BY a.id DESC`,
      [getUserId(req)],
    );

    // is_online = аккаунт РЕАЛЬНО подключён в текущем процессе (живой клиент
    // в памяти, слушает входящие). Отличается от is_autoreply_enabled — это
    // настройка в БД, которая может быть включена, но клиент ещё не поднят.
    const withOnline = accounts.map((account) => ({
      ...account,
      is_online: isActive(account.id),
      sent_today: Number(account.sent_today) || 0,
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

// Список диалогов с lead_score + воронка (sort=score|recent|funnel, stage=, hotOnly=1).
router.get('/conversations', async (req, res) => {
  try {
    const userId = getUserId(req);
    const sort =
      req.query.sort === 'recent' || req.query.sort === 'funnel' ? req.query.sort : 'score';
    const hotOnly = req.query.hotOnly === '1' || req.query.hotOnly === 'true';
    const stage = typeof req.query.stage === 'string' ? req.query.stage : null;
    const result = await leadScoring.listScoredConversations(userId, {
      sort,
      hotOnly,
      stage,
    });
    res.json({
      success: true,
      conversations: result.conversations,
      funnel: result.funnel,
      stages: result.stages,
      labels: result.labels,
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ success: false, error: 'Не удалось получить диалоги' });
  }
});

// Пауза / возврат ИИ на конкретном диалоге (оператор берёт чат).
router.post('/conversations/:accountId/:peerId/pause-bot', async (req, res) => {
  try {
    const userId = getUserId(req);
    const accountId = Number(req.params.accountId);
    const peerId = String(req.params.peerId || '');
    const paused = req.body?.paused !== false && req.body?.paused !== 0 && req.body?.paused !== '0';
    if (!accountId || !peerId) {
      return res.status(400).json({ success: false, error: 'Нужны accountId и peerId' });
    }
    const result = await leadScoring.setAutoreplyPaused(userId, accountId, peerId, paused);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Pause bot error:', error);
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      error: error.status === 404 ? error.message : 'Не удалось сменить паузу бота',
    });
  }
});

// Флаг «в фокусе» у оператора.
router.post('/conversations/:accountId/:peerId/focus', async (req, res) => {
  try {
    const userId = getUserId(req);
    const accountId = Number(req.params.accountId);
    const peerId = String(req.params.peerId || '');
    const focus = req.body?.focus !== false && req.body?.focus !== 0 && req.body?.focus !== '0';
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 255) : null;
    if (!accountId || !peerId) {
      return res.status(400).json({ success: false, error: 'Нужны accountId и peerId' });
    }
    const result = await leadScoring.setOperatorFocus(userId, accountId, peerId, focus, note);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Focus lead error:', error);
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      error: error.status === 404 ? error.message : 'Не удалось обновить фокус',
    });
  }
});

// Ручной этап воронки (stage=auto|hello|chat|interest|pitch|operator).
router.post('/conversations/:accountId/:peerId/funnel', async (req, res) => {
  try {
    const userId = getUserId(req);
    const accountId = Number(req.params.accountId);
    const peerId = String(req.params.peerId || '');
    const stage = req.body?.stage != null ? String(req.body.stage) : 'auto';
    if (!accountId || !peerId) {
      return res.status(400).json({ success: false, error: 'Нужны accountId и peerId' });
    }
    const result = await leadScoring.setFunnelStage(userId, accountId, peerId, stage);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Funnel stage error:', error);
    const status = error.status || 500;
    res.status(status).json({
      success: false,
      error:
        error.status === 404 || error.status === 400
          ? error.message
          : 'Не удалось обновить этап воронки',
    });
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

    await leadScoring.clearPeerConversation(accountId, peerId);

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

function connectCodeErrorMessage(error) {
  const raw = `${error?.errorMessage || ''} ${error?.message || ''}`;
  if (/FLOOD_WAIT_(\d+)/i.test(raw)) {
    const sec = Number(RegExp.$1);
    return `Telegram временно ограничил запросы. Подожди ~${Math.ceil(sec / 60)} мин и попробуй снова.`;
  }
  if (/FLOOD/i.test(raw)) {
    return 'Слишком много попыток. Подожди 30–60 минут и запроси код снова.';
  }
  if (/SEND_CODE_UNAVAILABLE/i.test(raw)) {
    return 'Telegram сейчас не отдаёт код на этот номер (лимит/повторы). Подожди ~30 мин, открой официальный Telegram на номере и попробуй снова.';
  }
  if (/PHONE_NUMBER_INVALID/i.test(raw)) return 'Неверный номер телефона';
  if (/PHONE_NUMBER_BANNED/i.test(raw)) return 'Этот номер заблокирован в Telegram';
  if (/PHONE_CODE_EXPIRED|PHONE_CODE_INVALID/i.test(raw)) {
    return 'Код неверный или просрочен. Запроси код заново.';
  }
  if (/timed out|Not connected|ECONN|SocksClient/i.test(raw)) {
    return 'Прокси до Telegram не отвечает. Попробуй ещё раз через минуту.';
  }
  if (error?.statusCode === 400 && error?.message) return error.message;
  return 'Не удалось отправить код';
}

// Шаг 1: пользователь ввёл телефон -> просим Telegram отправить код.
router.post('/connect/start', async (req, res) => {
  try {
    const phone = readPhone(req.body?.phone);
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Поле phone обязательно' });
    }

    const result = await startLogin(getUserId(req), phone);
    return res.json({
      success: true,
      status: 'codeSent',
      viaApp: !!result?.isCodeViaApp,
    });
  } catch (error) {
    console.error('Connect start error:', error);
    return res.status(500).json({ success: false, error: connectCodeErrorMessage(error) });
  }
});

// Повтор кода (часто SMS), пока жива pending-сессия после /connect/start.
router.post('/connect/resend', async (req, res) => {
  try {
    const phone = readPhone(req.body?.phone);
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Поле phone обязательно' });
    }
    const result = await resendLoginCode(getUserId(req), phone);
    return res.json({
      success: true,
      status: 'codeSent',
      viaApp: !!result?.isCodeViaApp,
      type: result?.type || null,
    });
  } catch (error) {
    console.error('Connect resend error:', error);
    return res.status(500).json({ success: false, error: connectCodeErrorMessage(error) });
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

function readBulkIds(body) {
  if (!Array.isArray(body?.ids) || !body.ids.length) return null;
  const ids = [...new Set(body.ids.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))];
  return ids.length ? ids : null;
}

// Массовое управление автоответами (все или выбранные ids).
router.post('/bulk/start-ai', async (req, res) => {
  try {
    const ids = readBulkIds(req.body);
    const params = [getUserId(req)];
    let where = 'user_id = ?';
    if (ids) {
      where += ` AND id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
    const [result] = await db.execute(
      `UPDATE accounts
       SET status = 'AI включен', is_autoreply_enabled = TRUE
       WHERE ${where}`,
      params,
    );
    const [accounts] = await db.execute(
      `SELECT id, session_string
       FROM accounts
       WHERE ${where} AND is_autoreply_enabled = TRUE`,
      params,
    );
    let offline = 0;
    for (const account of accounts) {
      if (!(await connectOwnedAccount(account))) {
        offline += 1;
        continue;
      }
      scanUnansweredDialogs(account.id, 0, { catchUp: true }).catch((e) =>
        console.error(`[bulk-start-ai ${account.id}] catch-up:`, e.message),
      );
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
    const ids = readBulkIds(req.body);
    const params = [getUserId(req)];
    let where = 'user_id = ?';
    if (ids) {
      where += ` AND id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
    const [result] = await db.execute(
      `UPDATE accounts
       SET status = 'Остановлен', is_autoreply_enabled = FALSE
       WHERE ${where}`,
      params,
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

    // Дочитать чаты, где писали до включения AI / пока были offline.
    scanUnansweredDialogs(account.id, 0, { catchUp: true }).catch((e) =>
      console.error(`[start-ai ${account.id}] catch-up:`, e.message),
    );

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
