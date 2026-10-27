const express = require('express');
const db = require('../db');
const {
  startLogin,
  startQrLogin,
  pollQrLogin,
  resendLoginCode,
  confirmCode,
  confirmPassword,
  extractLoginCode,
  normalizeLoginPhone,
  qrImageUrl,
  QR_MARKER,
  isActive,
  activateAccount,
  deactivateAccount,
  pingActiveSession,
  scanUnansweredDialogs,
  flushAllDeferredNow,
} = require('../services/telegramClient');
const { purgeAccount, renumberAccountSeq } = require('../services/accountCleanup');
const leadScoring = require('../services/leadScoring');
const ragExamples = require('../services/ragExamples');
const { getDialogAgeHours } = require('../services/history');

const router = express.Router();
const getUserId = require('../lib/getUserId');

// iPhone вставляет номер как «+7 958 738 14 82» или «8 (958) 738-14-82».
// Telegram принимает только цифры с плюсом, иначе код не уходит.
function normalizePhone(raw) {
  return normalizeLoginPhone(raw);
}

function phoneDigits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function readPhone(raw) {
  const phone = normalizePhone(raw);
  return phone.length >= 11 ? phone : '';
}

async function ownedAccount(req, id) {
  const [[row]] = await db.execute(
    'SELECT id, session_string, prompt FROM accounts WHERE id = ? AND user_id = ? LIMIT 1',
    [id, getUserId(req)],
  );
  return row || null;
}

async function connectOwnedAccount(account) {
  if (isActive(account.id)) return true;
  if (!account.session_string) return false;
  const online = await activateAccount(account.id, account.session_string);
  if (online === 'revoked') {
    const error = new Error(
      'Сессия отозвана — аккаунт сохранён, нужна повторная авторизация (QR/код)',
    );
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

function requireOpsLoopback(req, res) {
  const { isLoopback } = require('../middleware/telegramAuth');
  const expected = String(process.env.TELEGRAM_AUTH_BYPASS_KEY || '').trim();
  const got = String(req.get('X-Auth-Bypass-Key') || '').trim();
  if (!expected || got !== expected || !isLoopback(req)) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return false;
  }
  return true;
}

/**
 * Ops: дочитать ВСЕ непрочитанные + сразу слить «Занята»-deferred.
 * Loopback + bypass key. Не ждёт окончания сканов — стартует фоном.
 */
router.post('/catch-up-all', async (req, res) => {
  try {
    if (!requireOpsLoopback(req, res)) return;
    const deferredFlushed = flushAllDeferredNow();
    const [rows] = await db.execute(
      `SELECT id, phone, is_autoreply_enabled,
              CASE WHEN session_string IS NULL OR session_string = '' THEN 0 ELSE 1 END AS has_session
       FROM accounts
       ORDER BY id`,
    );
    const started = [];
    const skipped = [];
    for (const row of rows) {
      if (!Number(row.is_autoreply_enabled)) {
        skipped.push({ id: row.id, reason: 'ai_off' });
        continue;
      }
      if (!isActive(row.id)) {
        skipped.push({ id: row.id, reason: row.has_session ? 'offline' : 'no_session' });
        continue;
      }
      started.push(row.id);
      scanUnansweredDialogs(row.id, 0, {
        catchUp: true,
        maxReplies: 150,
        dialogsLimit: 500,
      }).catch((e) =>
        console.error(`[catch-up-all ${row.id}]`, e.message),
      );
    }
    console.log(
      `[catch-up-all] started=${started.length} deferred=${deferredFlushed} skipped=${skipped.length}`,
    );
    return res.json({
      success: true,
      started,
      deferredFlushed,
      skipped,
    });
  } catch (error) {
    console.error('catch-up-all error:', error);
    return res.status(500).json({ success: false, error: 'catch-up-all failed' });
  }
});

// Ops: статус ВСЕХ живых клиентов в процессе (не только аккаунты текущего user).
// Только socket-loopback + X-Auth-Bypass-Key (без XFF-spoof).
router.get('/pool-status', async (req, res) => {
  try {
    if (!requireOpsLoopback(req, res)) return;
    const [rows] = await db.execute(
      `SELECT id, phone, status, is_autoreply_enabled,
              CASE WHEN session_string IS NULL OR session_string = '' THEN 0 ELSE 1 END AS has_session
       FROM accounts
       ORDER BY id`,
    );
    const accounts = [];
    for (const row of rows) {
      const active = isActive(row.id);
      let ping = { ok: false, reason: row.has_session ? 'offline' : 'no_session' };
      if (active) {
        ping = await pingActiveSession(row.id);
      } else if (!row.has_session) {
        ping = { ok: false, reason: 'no_session' };
      }
      accounts.push({
        id: row.id,
        phone: row.phone,
        status: row.status,
        ai: Number(row.is_autoreply_enabled) === 1,
        has_session: !!row.has_session,
        is_online: active,
        ping_ok: !!ping.ok,
        ping_reason: ping.ok ? undefined : ping.reason,
        username: ping.username || null,
        firstName: ping.firstName || null,
      });
    }
    const online = accounts.filter((a) => a.is_online).length;
    const pingOk = accounts.filter((a) => a.ping_ok).length;
    return res.json({
      success: true,
      online,
      pingOk,
      total: accounts.length,
      accounts,
    });
  } catch (error) {
    console.error('pool-status error:', error);
    return res.status(500).json({ success: false, error: 'pool-status failed' });
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

/**
 * Экспорт переписки: JSON + plaintext для оператора.
 * ?format=text → text/plain; иначе JSON { messages, text }.
 */
router.get('/conversations/:accountId/:peerId/export', async (req, res) => {
  try {
    const userId = getUserId(req);
    const accountId = Number(req.params.accountId);
    const peerId = String(req.params.peerId || '');
    if (!accountId || !peerId) {
      return res.status(400).json({ success: false, error: 'Нужны accountId и peerId' });
    }
    const [[account]] = await db.execute(
      'SELECT id, phone FROM accounts WHERE id = ? AND user_id = ? LIMIT 1',
      [accountId, userId],
    );
    if (!account) {
      return res.status(404).json({ success: false, error: 'Аккаунт не найден' });
    }

    const [rows] = await db.execute(
      `SELECT role, content, created_at
       FROM conversation_messages
       WHERE account_id = ? AND peer_id = ?
       ORDER BY id ASC
       LIMIT 500`,
      [accountId, peerId],
    );
    const messages = (rows || []).map((r) => ({
      role: r.role,
      content: String(r.content || ''),
      at: r.created_at,
    }));
    const text = messages
      .map((m) => {
        const who = m.role === 'assistant' ? 'Она' : 'Он';
        return `${who}: ${m.content}`;
      })
      .join('\n');

    if (String(req.query.format || '').toLowerCase() === 'text') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="chat-${accountId}-${peerId}.txt"`,
      );
      return res.send(text || '(пусто)');
    }

    return res.json({
      success: true,
      accountId,
      peerId,
      phone: account.phone,
      count: messages.length,
      messages,
      text,
    });
  } catch (error) {
    console.error('Export conversation error:', error);
    res.status(500).json({ success: false, error: 'Не удалось экспортировать диалог' });
  }
});

/**
 * Последние пары user→assistant → training_examples (+ опционально RAG).
 * body: { limit?: number, toRag?: boolean, day?: 1|2 }
 */
router.post('/conversations/:accountId/:peerId/to-examples', async (req, res) => {
  try {
    const userId = getUserId(req);
    const accountId = Number(req.params.accountId);
    const peerId = String(req.params.peerId || '');
    if (!accountId || !peerId) {
      return res.status(400).json({ success: false, error: 'Нужны accountId и peerId' });
    }
    const [[account]] = await db.execute(
      'SELECT id FROM accounts WHERE id = ? AND user_id = ? LIMIT 1',
      [accountId, userId],
    );
    if (!account) {
      return res.status(404).json({ success: false, error: 'Аккаунт не найден' });
    }

    const limit = Math.max(1, Math.min(30, Number(req.body?.limit) || 8));
    const toRag = req.body?.toRag !== false && req.body?.toRag !== 0 && req.body?.toRag !== '0';
    let day = Number(req.body?.day) === 2 ? 2 : 1;
    if (req.body?.day == null) {
      try {
        const age = await getDialogAgeHours(accountId, peerId);
        day = ragExamples.dialogDayFromAgeHours(age);
      } catch (_) {
        /* default day 1 */
      }
    }

    const [rows] = await db.execute(
      `SELECT role, content
       FROM conversation_messages
       WHERE account_id = ? AND peer_id = ?
       ORDER BY id DESC
       LIMIT 120`,
      [accountId, peerId],
    );
    const chronological = (rows || []).slice().reverse();
    const pairs = [];
    for (let i = 0; i < chronological.length - 1; i++) {
      const a = chronological[i];
      const b = chronological[i + 1];
      if (a?.role !== 'user' || b?.role !== 'assistant') continue;
      const client = String(a.content || '')
        .replace(/\[реакция:[^\]]*\]/gi, '')
        .trim()
        .slice(0, 800);
      const bot = String(b.content || '').trim().slice(0, 800);
      if (!client || !bot || client.length < 2 || bot.length < 2) continue;
      pairs.push({ client, bot });
    }
    const selected = pairs.slice(-limit);

    let trainingAdded = 0;
    let ragAdded = 0;
    for (const p of selected) {
      try {
        await db.execute(
          `INSERT INTO training_examples
             (user_id, account_id, client_message, correct_answer, note)
           VALUES (?, ?, ?, ?, ?)`,
          [
            userId,
            accountId,
            p.client,
            p.bot,
            `export peer=${peerId}`,
          ],
        );
        trainingAdded += 1;
      } catch (err) {
        console.warn('[to-examples] training insert:', err.message);
      }
      if (toRag) {
        try {
          await ragExamples.upsertExample({
            day,
            clientMessage: p.client,
            botReply: p.bot,
            source: `export:${accountId}:${peerId}`,
          });
          ragAdded += 1;
        } catch (err) {
          console.warn('[to-examples] rag upsert:', err.message);
        }
      }
    }

    return res.json({
      success: true,
      pairsFound: pairs.length,
      trainingAdded,
      ragAdded,
      day,
      toRag,
    });
  } catch (error) {
    console.error('To-examples error:', error);
    res.status(500).json({ success: false, error: 'Не удалось сохранить примеры' });
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
    const existingAccount = owned.find(
      (row) => phoneDigits(row.phone) === phoneDigits(phone),
    );

    if (existingAccount) {
      return res.status(409).json({
        success: false,
        error: 'Аккаунт с таким телефоном уже добавлен',
      });
    }

    const userId = getUserId(req);
    const [result] = await db.execute(
      `INSERT INTO accounts (user_id, phone, prompt, status, is_autoreply_enabled)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, phone, prompt, 'Остановлен', false],
    );
    try {
      await renumberAccountSeq(userId);
    } catch (err) {
      console.error('[accounts] Не удалось пересчитать seq после CREATE:', err.message);
    }

    const [[account]] = await db.execute(
      `SELECT id, seq, phone, prompt, status, is_autoreply_enabled, created_at, updated_at
       FROM accounts
       WHERE id = ? AND user_id = ?`,
      [result.insertId, userId],
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

// QR-вход: старт (токен + картинка).
router.post('/connect/qr/start', async (req, res) => {
  try {
    const result = await startQrLogin(getUserId(req));
    if (result.status === 'ok' && result.sessionString) {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      const accountId = await saveSession(
        getUserId(req),
        result.phone,
        result.sessionString,
        prompt,
      );
      await deactivateAccount(accountId);
      const online = (await activateAccount(accountId, result.sessionString)) === true;
      return res.json({
        success: true,
        status: 'connected',
        phone: result.phone,
        is_online: online,
      });
    }
    if (result.status === 'needPassword') {
      return res.json({ success: true, status: 'needPassword', phone: QR_MARKER });
    }
    return res.json({
      success: true,
      status: 'pending',
      loginUrl: result.loginUrl,
      expires: result.expires,
      qrImage: result.loginUrl ? qrImageUrl(result.loginUrl) : null,
    });
  } catch (error) {
    console.error('Connect QR start error:', error);
    return res.status(500).json({ success: false, error: connectCodeErrorMessage(error) });
  }
});

// QR-вход: опрос скана.
router.post('/connect/qr/poll', async (req, res) => {
  try {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    const result = await pollQrLogin(getUserId(req));
    if (result.status === 'needPassword') {
      return res.json({ success: true, status: 'needPassword', phone: QR_MARKER });
    }
    if (result.status === 'ok' && result.sessionString) {
      const accountId = await saveSession(
        getUserId(req),
        result.phone,
        result.sessionString,
        prompt,
      );
      await deactivateAccount(accountId);
      const online = (await activateAccount(accountId, result.sessionString)) === true;
      return res.json({
        success: true,
        status: 'connected',
        phone: result.phone,
        is_online: online,
      });
    }
    return res.json({
      success: true,
      status: 'pending',
      loginUrl: result.loginUrl || null,
      expires: result.expires || null,
      qrImage: result.loginUrl ? qrImageUrl(result.loginUrl) : null,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    console.error('Connect QR poll error:', error);
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
    const rawPhone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
    const phone =
      rawPhone === QR_MARKER || rawPhone === 'qr' ? QR_MARKER : readPhone(req.body.phone);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!phone || !password) {
      return res.status(400).json({ success: false, error: 'Нужны phone и password' });
    }

    const result = await confirmPassword(getUserId(req), phone, password);

    const savePhone = result.phone && result.phone !== QR_MARKER ? result.phone : phone;
    if (!savePhone || savePhone === QR_MARKER) {
      return res.status(500).json({ success: false, error: 'Не удалось определить номер после 2FA' });
    }
    const accountId = await saveSession(getUserId(req), savePhone, result.sessionString, prompt);
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
    // Не включаем AI на аккаунтах без промпта / без сессии.
    const [eligible] = await db.execute(
      `SELECT id FROM accounts
       WHERE ${where}
         AND LENGTH(TRIM(COALESCE(prompt,''))) > 0
         AND LENGTH(COALESCE(session_string,'')) > 50`,
      params,
    );
    if (!eligible.length) {
      return res.status(400).json({
        success: false,
        error: 'Нет аккаунтов с промптом и живой сессией',
      });
    }
    const eligibleIds = eligible.map((r) => r.id);
    const [result] = await db.execute(
      `UPDATE accounts
       SET status = 'AI включен', is_autoreply_enabled = TRUE
       WHERE ${where} AND id IN (${eligibleIds.map(() => '?').join(',')})`,
      [...params, ...eligibleIds],
    );
    const [accounts] = await db.execute(
      `SELECT id, session_string, prompt
       FROM accounts
       WHERE ${where} AND is_autoreply_enabled = TRUE
         AND id IN (${eligibleIds.map(() => '?').join(',')})`,
      [...params, ...eligibleIds],
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
    // Снимаем клиентов с пула — иначе AI-off всё равно жрёт прокси/сканы.
    const [toStop] = await db.execute(
      `SELECT id FROM accounts WHERE ${where}`,
      params,
    );
    const [result] = await db.execute(
      `UPDATE accounts
       SET status = 'Остановлен', is_autoreply_enabled = FALSE
       WHERE ${where}`,
      params,
    );
    for (const row of toStop) {
      await deactivateAccount(row.id).catch(() => {});
    }
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

    if (!account.prompt || !String(account.prompt).trim()) {
      return res.status(400).json({
        success: false,
        error: 'Сначала задай промпт аккаунта — без него AI не включаем',
      });
    }

    if (!account.session_string) {
      return res.status(410).json({
        success: false,
        error: 'Нет сессии — подключи аккаунт заново (QR или код)',
      });
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

/** Здоровье сессии только через живой клиент в процессе (без второго GramJS). */
router.get('/:id/session-ping', async (req, res) => {
  try {
    const account = await ownedAccount(req, req.params.id);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Аккаунт не найден' });
    }
    const ping = await pingActiveSession(account.id);
    return res.json({ success: true, ...ping, is_online: isActive(account.id) });
  } catch (error) {
    console.error('session-ping error:', error);
    return res.status(500).json({ success: false, error: 'Не удалось проверить сессию' });
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

    // Снимаем с пула: нет сканов/приветствий/Whisper пока AI выключен.
    await deactivateAccount(req.params.id).catch(() => {});

    return res.json({
      success: true,
      status: 'Остановлен',
      is_autoreply_enabled: false,
      is_online: false,
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
  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 11) {
    const error = new Error('Неверный номер телефона');
    error.statusCode = 400;
    throw error;
  }
  const wantDigits = phoneDigits(normalized);

  const [owned] = await db.execute(
    'SELECT id, phone FROM accounts WHERE user_id = ?',
    [userId],
  );
  // Совпадение по цифрам — ловит «+7 995 930 71-73» и «+79959307173».
  const existing = owned.find((row) => phoneDigits(row.phone) === wantDigits);

  if (existing) {
    if (prompt) {
      await db.execute(
        'UPDATE accounts SET phone = ?, session_string = ?, status = ?, prompt = ?, is_autoreply_enabled = COALESCE(is_autoreply_enabled, 0) WHERE id = ? AND user_id = ?',
        [normalized, sessionString, 'Подключен', prompt, existing.id, userId],
      );
    } else {
      await db.execute(
        'UPDATE accounts SET phone = ?, session_string = ?, status = ? WHERE id = ? AND user_id = ?',
        [normalized, sessionString, 'Подключен', existing.id, userId],
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
    [userId, normalized, sessionString, 'Подключен', false, prompt || ''],
  );
  try {
    await renumberAccountSeq(userId);
  } catch (err) {
    console.error('[accounts] Не удалось пересчитать seq после session INSERT:', err.message);
  }
  return result.insertId;
}

module.exports = router;
