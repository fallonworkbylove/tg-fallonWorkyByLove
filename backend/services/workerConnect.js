/**
 * Подключение Telegram-аккаунта из бота-уведомителя (для воркеров).
 * Шаги: телефон → код → (2FA) → session в БД + activate.
 */

const db = require('../db');
const {
  startLogin,
  resendLoginCode,
  confirmCode,
  confirmPassword,
  cancelPendingLogin,
  cancelAllPendingLoginsForUser,
  activateAccount,
  deactivateAccount,
  isActive,
  accountLabel,
} = require('./telegramClient');
const {
  purgeAccount,
  renumberAccountSeq,
  ensureAccountSeqSchema,
} = require('./accountCleanup');
const operatorAccess = require('./operatorAccess');

const WIZARD_TTL_MS = 10 * 60 * 1000;

/** @type {Map<string, { until: number, step: string, phone?: string, userId?: number }>} */
const wizards = new Map();

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return `+${digits}`;
}

function clearWizard(chatId) {
  const key = String(chatId);
  const w = wizards.get(key);
  wizards.delete(key);
  // Снимаем GramJS pending, иначе orphan-клиент держит phoneCodeHash часами.
  if (w?.phone) {
    cancelPendingLogin(key, w.phone).catch(() => {});
  } else {
    cancelAllPendingLoginsForUser(key).catch(() => {});
  }
}

function isWizardActive(chatId) {
  const w = wizards.get(String(chatId));
  if (!w) return false;
  if (Date.now() > w.until) {
    clearWizard(chatId);
    return false;
  }
  return true;
}

function touch(chatId, patch) {
  const key = String(chatId);
  const prev = wizards.get(key) || {};
  const next = {
    ...prev,
    ...patch,
    until: Date.now() + WIZARD_TTL_MS,
  };
  wizards.set(key, next);
  return next;
}

function cancelKeyboard() {
  return {
    inline_keyboard: [[{ text: 'Отмена', callback_data: 'wrk:cancel' }]],
  };
}

function codeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📱 Не пришёл — прислать SMS', callback_data: 'wrk:sms' }],
      [{ text: 'Отмена', callback_data: 'wrk:cancel' }],
    ],
  };
}

function codeHint(isCodeViaApp) {
  if (isCodeViaApp) {
    return (
      'Код ушёл в <b>приложение Telegram</b> на этом номере — SMS не будет.\n\n' +
      'Открой Telegram на телефоне <b>этого</b> номера → чат «Telegram» (служебный) → код.\n\n' +
      'Если телефона/сессии нет — жми «Прислать SMS».'
    );
  }
  return 'Код отправлен (SMS / звонок / Telegram).\n\nПришли код цифрами.';
}

function doneKeyboard(isAdmin) {
  const rows = [
    [{ text: '📲 Ещё номер', callback_data: 'wrk:connect' }],
    [{ text: '🗑 Мои номера', callback_data: 'wrk:my' }],
  ];
  if (isAdmin) rows.push([{ text: '« Меню', callback_data: 'adm:menu' }]);
  else rows.push([{ text: '« Меню', callback_data: 'wrk:menu' }]);
  return { inline_keyboard: rows };
}

function workerMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📲 Подключить аккаунт', callback_data: 'wrk:connect' }],
      [{ text: '🗑 Мои номера', callback_data: 'wrk:my' }],
    ],
  };
}

async function listOwnedAccounts(userId) {
  try {
    await ensureAccountSeqSchema();
  } catch (_) {}
  const [rows] = await db.execute(
    `SELECT id, seq, phone, status, is_autoreply_enabled
     FROM accounts
     WHERE user_id = ?
     ORDER BY COALESCE(seq, id) ASC, id ASC`,
    [userId],
  );
  return rows;
}

function formatAccountLine(row) {
  let name = '';
  try {
    const label = String(accountLabel(row.id) || '');
    const parts = label.split(' — ');
    if (parts.length > 1) name = parts.slice(1).join(' — ');
  } catch (_) {}
  const online = isActive(row.id) ? '🟢' : '🔴';
  const ai = Number(row.is_autoreply_enabled) ? 'ИИ вкл' : 'ИИ выкл';
  const n = Number(row.seq) || '?';
  return (
    `<b>${n}.</b> ${online} <code>${esc(row.phone)}</code>` +
    (name ? ` — ${esc(name)}` : '') +
    `\n    ${ai}`
  );
}

async function buildMyAccountsView(userId) {
  const rows = await listOwnedAccounts(userId);
  if (!rows.length) {
    return {
      text:
        '<b>🗑 Мои номера</b>\n\n' +
        'Пока нет привязанных аккаунтов.\n' +
        'Подключи через «Подключить аккаунт».',
      keyboard: {
        inline_keyboard: [
          [{ text: '📲 Подключить', callback_data: 'wrk:connect' }],
          [{ text: '« Меню', callback_data: 'wrk:menu' }],
        ],
      },
    };
  }

  const lines = rows.map(formatAccountLine);
  const buttons = rows.map((row) => {
    const n = Number(row.seq) || row.id;
    return [
      {
        text: `🗑 Удалить ${n}`,
        callback_data: `wrk:del:${row.id}`,
      },
    ];
  });
  buttons.push([{ text: '🔄 Обновить', callback_data: 'wrk:my' }]);
  buttons.push([{ text: '« Меню', callback_data: 'wrk:menu' }]);

  return {
    text:
      `<b>🗑 Мои номера</b> · ${rows.length}\n\n` +
      `${lines.join('\n\n')}\n\n` +
      '<i>№ списка 1…N без дыр; после удаления пересчитывается. Сессия снимается с сервера; из Telegram аккаунт не выходит.</i>',
    keyboard: { inline_keyboard: buttons },
  };
}

async function sendWorkerMenu(api, chatId) {
  await apiSend(
    api,
    chatId,
    '<b>Меню воркера</b>\n\nПодключи номер или удали свой аккаунт из бота.',
    workerMenuKeyboard(),
  );
}

async function showMyAccounts(api, chatId, from, { editMessageId } = {}) {
  if (!(await canConnectAccounts(chatId, from?.username))) {
    const text = 'Нет доступа.';
    if (editMessageId) await apiEdit(api, chatId, editMessageId, text);
    else await apiSend(api, chatId, text);
    return;
  }
  const user = await ensureDbUser(chatId, from);
  const view = await buildMyAccountsView(user.id);
  // Админам кнопка «Меню» ведёт в adm:menu
  if (operatorAccess.isAdminSync(chatId, from?.username)) {
    view.keyboard.inline_keyboard = view.keyboard.inline_keyboard.map((row) =>
      row.map((btn) =>
        btn.callback_data === 'wrk:menu'
          ? { ...btn, callback_data: 'adm:menu' }
          : btn,
      ),
    );
  }
  if (editMessageId) {
    await apiEdit(api, chatId, editMessageId, view.text, view.keyboard);
  } else {
    await apiSend(api, chatId, view.text, view.keyboard);
  }
}

async function deleteOwnedAccount(api, chatId, from, accountId, { editMessageId } = {}) {
  const user = await ensureDbUser(chatId, from);
  const id = Number(accountId);
  const [[row]] = await db.execute(
    'SELECT id, phone FROM accounts WHERE id = ? AND user_id = ? LIMIT 1',
    [id, user.id],
  );
  if (!row) {
    const text = 'Номер не найден или это не твой аккаунт.';
    if (editMessageId) await apiEdit(api, chatId, editMessageId, text);
    else await apiSend(api, chatId, text);
    return;
  }

  try {
    await deactivateAccount(id);
  } catch (_) {}
  const removed = await purgeAccount(id, user.id);
  const text = removed
    ? `<b>✅ Удалено</b>\n\nНомер <code>${esc(row.phone)}</code> снят с бота.`
    : 'Не удалось удалить из базы.';
  const isAdmin = operatorAccess.isAdminSync(chatId, from?.username);
  const keyboard = {
    inline_keyboard: [
      [{ text: '🗑 Мои номера', callback_data: 'wrk:my' }],
      [
        {
          text: '« Меню',
          callback_data: isAdmin ? 'adm:menu' : 'wrk:menu',
        },
      ],
    ],
  };
  if (editMessageId) await apiEdit(api, chatId, editMessageId, text, keyboard);
  else await apiSend(api, chatId, text, keyboard);
}

/** Воркер = тестер или админ (есть доступ к продукту). */
async function canConnectAccounts(chatId, username) {
  if (await operatorAccess.isAdmin(chatId, username)) return true;
  return !!(await operatorAccess.isBetaTester({
    telegram_user_id: chatId,
    username,
  }));
}

async function ensureDbUser(chatId, from) {
  const telegramId = String(chatId);
  const username = from?.username || null;
  const firstName = from?.first_name || null;

  const [rows] = await db.execute(
    'SELECT * FROM users WHERE telegram_user_id = ? LIMIT 1',
    [telegramId],
  );
  if (rows.length) {
    const user = rows[0];
    if (Number(user.is_blocked) === 1) {
      const err = new Error('Доступ закрыт');
      err.statusCode = 403;
      throw err;
    }
    if (
      (username && user.username !== username) ||
      (firstName && user.first_name !== firstName)
    ) {
      await db.execute(
        'UPDATE users SET username = ?, first_name = ? WHERE id = ?',
        [username || user.username, firstName || user.first_name, user.id],
      );
    }
    return user;
  }

  await db.execute(
    `INSERT INTO users (telegram_user_id, username, first_name)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE telegram_user_id = telegram_user_id`,
    [telegramId, username, firstName],
  );
  const [created] = await db.execute(
    'SELECT * FROM users WHERE telegram_user_id = ? LIMIT 1',
    [telegramId],
  );
  return created[0];
}

async function getAccountLimit(userId) {
  const [[user]] = await db.execute(
    'SELECT account_limit FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  const limit = Number(user?.account_limit);
  return Number.isFinite(limit) && limit > 0 ? limit : 10;
}

async function saveSession(userId, phone, sessionString) {
  const [owned] = await db.execute(
    'SELECT id, phone FROM accounts WHERE user_id = ?',
    [userId],
  );
  const existing = owned.find((row) => normalizePhone(row.phone) === phone);
  if (existing) {
    await db.execute(
      'UPDATE accounts SET phone = ?, session_string = ?, status = ? WHERE id = ? AND user_id = ?',
      [phone, sessionString, 'Подключен', existing.id, userId],
    );
    return existing.id;
  }

  const limit = await getAccountLimit(userId);
  const [[countRow]] = await db.execute(
    'SELECT COUNT(*) AS total FROM accounts WHERE user_id = ?',
    [userId],
  );
  if (Number(countRow.total) >= limit) {
    const err = new Error(`Нельзя добавить больше ${limit} аккаунтов`);
    err.statusCode = 400;
    throw err;
  }

  const [result] = await db.execute(
    `INSERT INTO accounts (user_id, phone, session_string, status, is_autoreply_enabled, prompt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, phone, sessionString, 'Подключен', false, ''],
  );
  try {
    await renumberAccountSeq(userId);
  } catch (err) {
    console.error('[workerConnect] Не удалось пересчитать seq после INSERT:', err.message);
  }
  return result.insertId;
}

function loginErrorMessage(error) {
  const raw = `${error?.errorMessage || ''} ${error?.message || ''}`;
  if (/FLOOD_WAIT_(\d+)/i.test(raw)) {
    const sec = Number(RegExp.$1);
    return `Telegram ограничил запросы. Подожди ~${Math.ceil(sec / 60)} мин.`;
  }
  if (/FLOOD/i.test(raw)) {
    return 'Слишком много попыток. Подожди 30–60 минут.';
  }
  if (/SEND_CODE_UNAVAILABLE/i.test(raw)) {
    return 'Telegram сейчас не отдаёт код на этот номер. Подожди ~30 мин и попробуй снова.';
  }
  if (/PHONE_NUMBER_INVALID/i.test(raw)) return 'Неверный номер телефона.';
  if (/PHONE_NUMBER_BANNED/i.test(raw)) return 'Номер заблокирован в Telegram.';
  if (/PHONE_CODE_INVALID|PHONE_CODE_EXPIRED/i.test(raw)) {
    return 'Неверный или просроченный код. Запроси код заново.';
  }
  if (/PASSWORD_HASH_INVALID|PASSWORD_MISSING/i.test(raw)) {
    return 'Неверный облачный пароль.';
  }
  if (/timed out|Not connected|ECONN|SocksClient/i.test(raw)) {
    return 'Прокси до Telegram не отвечает. Попробуй ещё раз.';
  }
  if (error?.statusCode === 403) return 'Доступ закрыт.';
  if (error?.statusCode === 400) return error.message;
  return `Не удалось: ${error?.errorMessage || error?.message || 'ошибка'}`;
}

async function startWizard(api, chatId, from, { editMessageId } = {}) {
  if (!(await canConnectAccounts(chatId, from?.username))) {
    await apiSend(api, chatId, 'Нет доступа. Нужна роль воркера (тестер/админ).');
    return;
  }

  const user = await ensureDbUser(chatId, from);
  touch(chatId, { step: 'phone', userId: user.id, phone: undefined });

  const text =
    '<b>📲 Подключение аккаунта</b>\n\n' +
    'Пришли номер телефона в международном формате, например:\n' +
    '<code>+79001234567</code>\n\n' +
    'Код придёт в <b>приложение Telegram</b> на этом номере (часто не SMS).';

  if (editMessageId) {
    await apiEdit(api, chatId, editMessageId, text, cancelKeyboard());
  } else {
    await apiSend(api, chatId, text, cancelKeyboard());
  }
}

async function finishConnect(api, chatId, userId, phone, sessionString, isAdmin) {
  const accountId = await saveSession(userId, phone, sessionString);
  await deactivateAccount(accountId);
  const online = (await activateAccount(accountId, sessionString)) === true;
  clearWizard(chatId);
  await apiSend(
    api,
    chatId,
    `<b>✅ Аккаунт подключён</b>\n\n` +
      `Номер: <code>${esc(phone)}</code>\n` +
      `ID: <code>${accountId}</code>\n` +
      `Онлайн: ${online ? 'да' : 'нет (проверь сессию / прокси)'}\n\n` +
      `ИИ по умолчанию выключен — включи в мини-аппе или попроси админа.`,
    doneKeyboard(isAdmin),
  );
}

async function handleText(api, chatId, text, from) {
  if (!isWizardActive(chatId)) return false;
  const w = wizards.get(String(chatId));
  if (!w) return false;

  if (text === '/cancel' || /^отмена$/i.test(text)) {
    clearWizard(chatId);
    await apiSend(api, chatId, 'Подключение отменено.');
    return true;
  }

  const isAdmin = operatorAccess.isAdminSync(chatId, from?.username);

  try {
    if (w.step === 'phone') {
      const phone = normalizePhone(text);
      if (phone.length < 11) {
        await apiSend(
          api,
          chatId,
          'Нужен полный номер, например <code>+79001234567</code>',
          cancelKeyboard(),
        );
        return true;
      }
      await apiSend(api, chatId, `⏳ Запрашиваю код для <code>${esc(phone)}</code>…`);
      const result = await startLogin(String(chatId), phone);
      touch(chatId, { step: 'code', phone, userId: w.userId });
      await apiSend(
        api,
        chatId,
        `${codeHint(!!result?.isCodeViaApp)}\n\nПришли код цифрами.`,
        codeKeyboard(),
      );
      return true;
    }

    if (w.step === 'code') {
      const code = String(text || '').replace(/\s+/g, '');
      if (!/^\d{4,8}$/.test(code)) {
        await apiSend(api, chatId, 'Код — только цифры (обычно 5–6 знаков).', codeKeyboard());
        return true;
      }
      await apiSend(api, chatId, '⏳ Проверяю код…');
      const result = await confirmCode(String(chatId), w.phone, code);
      if (result.status === 'needPassword') {
        touch(chatId, { step: 'password' });
        await apiSend(
          api,
          chatId,
          'На аккаунте включена 2FA. Пришли <b>облачный пароль</b>.',
          cancelKeyboard(),
        );
        return true;
      }
      await finishConnect(api, chatId, w.userId, w.phone, result.sessionString, isAdmin);
      return true;
    }

    if (w.step === 'password') {
      const password = String(text || '');
      if (!password) {
        await apiSend(api, chatId, 'Введи облачный пароль.', cancelKeyboard());
        return true;
      }
      await apiSend(api, chatId, '⏳ Проверяю пароль…');
      const result = await confirmPassword(String(chatId), w.phone, password);
      await finishConnect(api, chatId, w.userId, w.phone, result.sessionString, isAdmin);
      return true;
    }
  } catch (err) {
    console.error('[workerConnect]', err.errorMessage || err.message);
    const msg = loginErrorMessage(err);
    // На фатальных ошибках кода — можно начать заново с телефона
    if (/PHONE_CODE|SEND_CODE|FLOOD|PHONE_NUMBER/i.test(`${err.errorMessage || ''} ${err.message || ''}`)) {
      clearWizard(chatId);
      await apiSend(
        api,
        chatId,
        `❌ ${esc(msg)}\n\nНажми «Подключить аккаунт», чтобы начать заново.`,
        doneKeyboard(isAdmin),
      );
    } else {
      await apiSend(api, chatId, `❌ ${esc(msg)}`, cancelKeyboard());
    }
    return true;
  }

  return false;
}

async function handleCallback(api, query) {
  const data = String(query.data || '');
  if (!data.startsWith('wrk:')) return false;

  const chatId = String(query.message?.chat?.id || '');
  const from = query.from;
  await apiCall(api, 'answerCallbackQuery', { callback_query_id: query.id });

  if (data === 'wrk:cancel') {
    clearWizard(chatId);
    await apiEdit(
      api,
      chatId,
      query.message.message_id,
      'Подключение отменено.',
      operatorAccess.isAdminSync(chatId, from?.username)
        ? { inline_keyboard: [[{ text: '« Меню', callback_data: 'adm:menu' }]] }
        : undefined,
    );
    return true;
  }

  if (data === 'wrk:connect') {
    try {
      await startWizard(api, chatId, from, { editMessageId: query.message.message_id });
    } catch (err) {
      await apiEdit(
        api,
        chatId,
        query.message.message_id,
        `❌ ${esc(loginErrorMessage(err))}`,
      );
    }
    return true;
  }

  if (data === 'wrk:menu') {
    if (!(await canConnectAccounts(chatId, from?.username))) {
      await apiEdit(api, chatId, query.message.message_id, 'Нет доступа.');
      return true;
    }
    if (operatorAccess.isAdminSync(chatId, from?.username)) {
      const adminMenu = require('./adminMenu');
      await adminMenu.sendMenu(api, chatId);
      return true;
    }
    await apiEdit(
      api,
      chatId,
      query.message.message_id,
      '<b>Меню воркера</b>\n\nПодключи номер или удали свой аккаунт из бота.',
      workerMenuKeyboard(),
    );
    return true;
  }

  if (data === 'wrk:my') {
    await showMyAccounts(api, chatId, from, {
      editMessageId: query.message.message_id,
    });
    return true;
  }

  const delAsk = data.match(/^wrk:del:(\d+)$/);
  if (delAsk) {
    const id = delAsk[1];
    const user = await ensureDbUser(chatId, from);
    const [[row]] = await db.execute(
      'SELECT id, seq, phone FROM accounts WHERE id = ? AND user_id = ? LIMIT 1',
      [id, user.id],
    );
    if (!row) {
      await apiEdit(
        api,
        chatId,
        query.message.message_id,
        'Номер не найден или это не твой аккаунт.',
      );
      return true;
    }
    const isAdmin = operatorAccess.isAdminSync(chatId, from?.username);
    const n = Number(row.seq) || '?';
    await apiEdit(
      api,
      chatId,
      query.message.message_id,
      `<b>Удалить №${n}?</b>\n\n<code>${esc(row.phone)}</code>\n\n` +
        'Сессия снимется с сервера, история в боте очистится.',
      {
        inline_keyboard: [
          [
            { text: '✅ Да, удалить', callback_data: `wrk:delc:${id}` },
            { text: 'Отмена', callback_data: 'wrk:my' },
          ],
          [
            {
              text: '« Меню',
              callback_data: isAdmin ? 'adm:menu' : 'wrk:menu',
            },
          ],
        ],
      },
    );
    return true;
  }

  const delConfirm = data.match(/^wrk:delc:(\d+)$/);
  if (delConfirm) {
    await deleteOwnedAccount(api, chatId, from, delConfirm[1], {
      editMessageId: query.message.message_id,
    });
    return true;
  }

  if (data === 'wrk:sms') {
    const w = wizards.get(String(chatId));
    if (!w || w.step !== 'code' || !w.phone) {
      await apiSend(api, chatId, 'Сначала запроси код (номер → жди код).');
      return true;
    }
    try {
      await apiSend(api, chatId, '⏳ Прошу Telegram прислать код по SMS…');
      const result = await resendLoginCode(String(chatId), w.phone);
      touch(chatId, { step: 'code' });
      const via = result?.isCodeViaApp
        ? 'Telegram снова шлёт в <b>приложение</b> (SMS недоступен сейчас). Открой Telegram на этом номере или подожди ~30 мин.'
        : 'Должен прийти <b>SMS</b> (или звонок). Проверь телефон.';
      await apiSend(api, chatId, `${via}\n\nПришли код цифрами.`, codeKeyboard());
    } catch (err) {
      console.error('[workerConnect] sms resend:', err.errorMessage || err.message);
      await apiSend(
        api,
        chatId,
        `❌ ${esc(loginErrorMessage(err))}\n\nМожно ввести код из приложения или начать заново.`,
        codeKeyboard(),
      );
    }
    return true;
  }

  return false;
}

async function apiCall(apiBase, method, payload) {
  const res = await fetch(`${apiBase}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => ({}));
}

async function apiSend(apiBase, chatId, text, reply_markup) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (reply_markup) payload.reply_markup = reply_markup;
  return apiCall(apiBase, 'sendMessage', payload);
}

async function apiEdit(apiBase, chatId, messageId, text, reply_markup) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (reply_markup) payload.reply_markup = reply_markup;
  return apiCall(apiBase, 'editMessageText', payload);
}

module.exports = {
  canConnectAccounts,
  startWizard,
  handleText,
  handleCallback,
  isWizardActive,
  clearWizard,
  cancelKeyboard,
  sendWorkerMenu,
  showMyAccounts,
};
