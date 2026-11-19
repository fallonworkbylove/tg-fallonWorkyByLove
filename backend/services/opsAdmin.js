/**
 * /menu → «Доступ»: тестеры и админы по Telegram ID (username — только подпись).
 */

const access = require('./operatorAccess');
const db = require('../db');

const INPUT_TTL_MS = 5 * 60 * 1000;

/** @type {Map<string, { until: number, step: string, role?: string }>} */
const wizards = new Map();

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function wizardKey(chatId) {
  return String(chatId || '');
}

function clearWizard(chatId) {
  if (chatId == null) {
    wizards.clear();
    return;
  }
  wizards.delete(wizardKey(chatId));
}

function isWizardActive(chatId) {
  if (chatId != null) {
    const w = wizards.get(wizardKey(chatId));
    if (!w) return false;
    if (Date.now() > w.until) {
      wizards.delete(wizardKey(chatId));
      return false;
    }
    return true;
  }
  // Legacy: любой активный wizard (не использовать для handleText)
  for (const [k, w] of wizards) {
    if (Date.now() > w.until) wizards.delete(k);
    else return true;
  }
  return false;
}

function roleLabel(role) {
  return role === 'admin' ? 'админ' : 'тестер';
}

function titleOf(row) {
  if (row.username) return `@${row.username}`;
  if (row.telegram_user_id) return `id ${row.telegram_user_id}`;
  return `#${row.id}`;
}

async function findUserHint(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^@/, '');
  if (!cleaned) return null;

  if (/^\d{5,15}$/.test(cleaned)) {
    const [[u]] = await db.execute(
      'SELECT telegram_user_id, username, first_name FROM users WHERE telegram_user_id = ? LIMIT 1',
      [cleaned],
    );
    return {
      telegram_user_id: cleaned,
      username: u?.username || null,
      first_name: u?.first_name || null,
      known: Boolean(u),
    };
  }

  if (!/^[A-Za-z0-9_]{3,32}$/.test(cleaned)) return null;

  const [[u]] = await db.execute(
    'SELECT telegram_user_id, username, first_name FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1',
    [cleaned],
  );
  if (!u?.telegram_user_id) {
    return {
      telegram_user_id: null,
      username: cleaned,
      first_name: null,
      known: false,
      needNumericId: true,
    };
  }
  return {
    telegram_user_id: String(u.telegram_user_id),
    username: cleaned,
    first_name: u?.first_name || null,
    known: true,
  };
}

async function buildListView(notice = '') {
  await access.ensureSchema();
  const rows = await access.listOperators();
  const envIds = [...access.envTesterIds()].filter((id) => id !== access.SUPER_ADMIN_ID);
  const envNames = [...access.envTesterUsernames()];
  const superUname =
    (await access.resolveSuperAdminUsername().catch(() => null)) ||
    access.SUPER_ADMIN_USERNAME ||
    '—';

  const admins = rows.filter(
    (r) =>
      r.role === 'admin' &&
      !access.isSuperAdmin(r.telegram_user_id, r.username),
  );
  const testers = rows.filter((r) => r.role === 'tester');

  const fmt = (list) =>
    list.length
      ? list
          .map((r) => {
            const bits = [];
            if (r.username) bits.push(`@${esc(r.username)}`);
            if (r.telegram_user_id) bits.push(`<code>${esc(r.telegram_user_id)}</code>`);
            return `• ${bits.join(' · ') || esc(titleOf(r))}`;
          })
          .join('\n')
      : '<i>пусто</i>';

  const text =
    (notice ? `${notice}\n\n` : '') +
    '<b>👥 Доступ операторов</b>\n\n' +
    `<b>Суперадмин</b> — создатель, полный доступ, не снимается:\n` +
    `• @${esc(superUname)} · <code>${esc(access.SUPER_ADMIN_ID || '—')}</code>\n` +
    `<i>Ты здесь, а не в списке «Админы» ниже — так и задумано.</i>\n\n` +
    `<b>Админы</b> (добавленные, /menu + бета):\n${fmt(admins)}\n\n` +
    `<b>Тестеры</b> (бета-фичи, сайты):\n${fmt(testers)}\n\n` +
    (envIds.length || envNames.length
      ? `<b>Из .env (тестеры)</b>:\n` +
        (envIds.length ? `ID: ${envIds.map((id) => `<code>${esc(id)}</code>`).join(', ')}\n` : '') +
        (envNames.length
          ? `User: ${envNames.map((n) => `@${esc(n)}`).join(', ')}\n`
          : '') +
        '\n'
      : '') +
    '<i>Админ видит /menu. Тестер — расширенный доступ к miniapp API. ' +
    'Добавляй по числовому Telegram ID (обязательно).</i>';

  const keyboard = [];
  for (const r of rows.slice(0, 25)) {
    const label = `🗑 ${roleLabel(r.role)} ${titleOf(r)}`.slice(0, 56);
    keyboard.push([{ text: label, callback_data: `adm:ops:rm:${r.id}` }]);
  }
  keyboard.push([
    { text: '➕ Тестер', callback_data: 'adm:ops:add:tester' },
    { text: '➕ Админ', callback_data: 'adm:ops:add:admin' },
  ]);
  keyboard.push([
    { text: '🔄 Обновить', callback_data: 'adm:ops' },
    { text: '« Меню', callback_data: 'adm:menu' },
  ]);

  return { text: text.slice(0, 3900), reply_markup: { inline_keyboard: keyboard } };
}

function askInput(role, chatId) {
  const key = wizardKey(chatId);
  wizards.set(key, {
    until: Date.now() + INPUT_TTL_MS,
    step: 'wait_identity',
    role: role === 'admin' ? 'admin' : 'tester',
  });
  const w = wizards.get(key);
  return {
    text:
      `➕ Добавить <b>${esc(roleLabel(w.role))}</b>\n\n` +
      'Пришли следующим сообщением <b>числовой Telegram ID</b> оператора.\n' +
      'Можно <code>@username</code>, если человек уже заходил в miniapp (ID подтянется из базы).\n' +
      'Без ID доступ не выдаём.',
    reply_markup: {
      inline_keyboard: [[{ text: 'Отмена', callback_data: 'adm:ops' }]],
    },
  };
}

/**
 * @returns {Promise<boolean>}
 */
async function handleText(api, chatId, text, tgSend) {
  const key = wizardKey(chatId);
  const wizard = wizards.get(key);
  if (!wizard || Date.now() > wizard.until) {
    clearWizard(chatId);
    return false;
  }
  // Только суперадмин завершает wizard (защита от чужого admin-чата).
  if (!access.isSuperAdmin(chatId)) {
    clearWizard(chatId);
    return false;
  }
  if (String(text || '').startsWith('/')) {
    clearWizard(chatId);
    return false;
  }

  const role = wizard.role || 'tester';
  clearWizard(chatId);

  const hint = await findUserHint(text);
  if (!hint || hint.needNumericId || !hint.telegram_user_id) {
    await tgSend(
      api,
      chatId,
      hint?.needNumericId
        ? `У <b>@${esc(hint.username)}</b> нет ID в базе. Пришли числовой Telegram ID.`
        : `Не понял <b>${esc(text)}</b>. Нужен числовой Telegram ID.`,
      {
        text: hint?.needNumericId
          ? `У <b>@${esc(hint.username)}</b> нет ID в базе. Пришли числовой Telegram ID.`
          : `Не понял <b>${esc(text)}</b>. Нужен числовой Telegram ID.`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔁 Ещё раз', callback_data: `adm:ops:add:${role}` },
              { text: '« Доступ', callback_data: 'adm:ops' },
            ],
          ],
        },
      },
    );
    return true;
  }

  if (access.isSuperAdmin(hint.telegram_user_id)) {
    const view = await buildListView('ℹ️ Это суперадмин — уже полный доступ.');
    await tgSend(api, chatId, null, view);
    return true;
  }

  try {
    const { row, created } = await access.upsertOperator({
      telegramUserId: hint.telegram_user_id,
      username: hint.username,
      role,
      createdBy: chatId,
      note: hint.known ? 'из users' : 'добавлен по ID',
    });
    const view = await buildListView(
      `${created ? '✅ Добавлен' : '✅ Обновлён'} ${esc(roleLabel(row.role))}: ` +
        `${esc(titleOf(row))}` +
        (hint.known ? '' : ' <i>(ещё не был в miniapp — ок)</i>'),
    );
    await tgSend(api, chatId, null, view);
  } catch (err) {
    const view = await buildListView(`❌ ${esc(err.message)}`);
    await tgSend(api, chatId, null, view);
  }
  return true;
}

async function handleCallback(api, data, target, tg) {
  const chatId = target?.chat_id;
  if (data === 'adm:ops') {
    clearWizard(chatId);
    const view = await buildListView();
    await tg(api, 'editMessageText', { ...target, ...view });
    return true;
  }

  const addMatch = data.match(/^adm:ops:add:(tester|admin)$/);
  if (addMatch) {
    if (!access.isSuperAdmin(chatId)) {
      const view = await buildListView('❌ Только суперадмин может выдавать доступ.');
      await tg(api, 'editMessageText', { ...target, ...view });
      return true;
    }
    const view = askInput(addMatch[1], chatId);
    await tg(api, 'editMessageText', { ...target, ...view });
    return true;
  }

  const rmMatch = data.match(/^adm:ops:rm:(\d+)$/);
  if (rmMatch) {
    const id = Number(rmMatch[1]);
    const rows = await access.listOperators();
    const row = rows.find((r) => Number(r.id) === id);
    if (!row) {
      const view = await buildListView('❌ Уже нет в списке.');
      await tg(api, 'editMessageText', { ...target, ...view });
      return true;
    }
    await tg(api, 'editMessageText', {
      ...target,
      text:
        `Снять доступ у <b>${esc(titleOf(row))}</b> (${esc(roleLabel(row.role))})?`,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Снять', callback_data: `adm:ops:rx:${id}` },
            { text: 'Отмена', callback_data: 'adm:ops' },
          ],
        ],
      },
    });
    return true;
  }

  const rxMatch = data.match(/^adm:ops:rx:(\d+)$/);
  if (rxMatch) {
    try {
      const ok = await access.removeOperator(Number(rxMatch[1]));
      const view = await buildListView(ok ? '🗑 Доступ снят.' : '❌ Не найден.');
      await tg(api, 'editMessageText', { ...target, ...view });
    } catch (err) {
      const view = await buildListView(`❌ ${esc(err.message)}`);
      await tg(api, 'editMessageText', { ...target, ...view });
    }
    return true;
  }

  return false;
}

function isOpsCallback(data) {
  return String(data || '').startsWith('adm:ops');
}

module.exports = {
  buildListView,
  handleCallback,
  handleText,
  isOpsCallback,
  isWizardActive,
  clearWizard,
};
