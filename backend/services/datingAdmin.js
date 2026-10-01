/**
 * Админ-управление сайтами знакомств через /menu (только ADMIN_ALERT_CHAT_ID).
 *
 * Возможности: список, карточка, вкл/выкл, смена языка/таймера, смена TG,
 * удаление, добавление мастером, пример инвайта, экспорт воркеру.
 */

const store = require('./datingSitesStore');

const INPUT_TTL_MS = 5 * 60 * 1000;

/** @type {{ until: number, step: string, data: object, editId?: number } | null} */
let wizard = null;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function clearWizard() {
  wizard = null;
}

function siteLabel(site) {
  return 'Tagged';
}

function minsRange(row) {
  const a = Math.round((Number(row.invite_after_min) || 180) / 60);
  const b = Math.round((Number(row.invite_after_max) || 240) / 60);
  return `${a}–${b} мин`;
}

function rowTitle(row) {
  const name = row.persona_name || row.login;
  const tg = row.telegram_username ? `@${row.telegram_username}` : '—';
  return `${siteLabel(row.site)} · ${name} → ${tg}`;
}

async function resolveOwnerUserId(adminTelegramId) {
  const uid = await store.resolveUserIdByTelegram(adminTelegramId);
  return uid || 1;
}

async function buildListView(notice = '') {
  const rows = await store.listAccounts();
  const enabled = rows.filter((r) => Number(r.is_enabled) === 1).length;
  const lines = rows.slice(0, 40).map((r) => {
    const mark = Number(r.is_enabled) === 1 ? '🟢' : '⏸';
    const err = r.last_error ? ` · ⚠️ ${String(r.last_error).slice(0, 40)}` : '';
    return (
      `${mark} <b>#${r.id}</b> ${esc(siteLabel(r.site))} · ` +
      `<code>${esc(r.login)}</code>\n` +
      `    ${esc(r.persona_name || '—')} → @${esc(r.telegram_username || '—')} · ` +
      `${esc(minsRange(r))} · ${esc(r.language || 'en')} · ${esc(r.status || 'idle')}${esc(err)}`
    );
  });

  const text =
    (notice ? `${notice}\n\n` : '') +
    '<b>💘 Сайты знакомств</b>\n\n' +
    `Всего: <b>${rows.length}</b>, включено: <b>${enabled}</b>\n\n` +
    (lines.length ? lines.join('\n\n') : '<i>Пока пусто — добавь первый аккаунт.</i>') +
    '\n\n<i>Каждый сайт-аккаунт зовёт в свой Telegram через 3–4 минуты общения. ' +
    'Раздел только у тебя в /menu.</i>';

  const keyboard = [];
  for (const r of rows.slice(0, 20)) {
    const short = `${Number(r.is_enabled) === 1 ? '🟢' : '⏸'} #${r.id} ${r.persona_name || r.login}`.slice(0, 56);
    keyboard.push([{ text: short, callback_data: `adm:dt:v:${r.id}` }]);
  }
  keyboard.push([
    { text: '➕ Добавить', callback_data: 'adm:dt:add' },
    { text: '💬 Пример инвайта', callback_data: 'adm:dt:preview' },
  ]);
  keyboard.push([
    { text: '📤 Экспорт воркеру', callback_data: 'adm:dt:export' },
    { text: '🔄 Обновить', callback_data: 'adm:dt' },
  ]);
  keyboard.push([{ text: '« Меню', callback_data: 'adm:menu' }]);

  return { text: text.slice(0, 3900), reply_markup: { inline_keyboard: keyboard } };
}

async function buildCardView(id, notice = '') {
  const row = await store.getAccount(Number(id));
  if (!row) {
    return buildListView('❌ Аккаунт не найден.');
  }
  const enabled = Number(row.is_enabled) === 1;
  const text =
    (notice ? `${notice}\n\n` : '') +
    `<b>💘 #${row.id} — ${esc(rowTitle(row))}</b>\n\n` +
    `Сайт: <b>${esc(siteLabel(row.site))}</b>\n` +
    `Логин: <code>${esc(row.login)}</code>\n` +
    `Пароль: ${row.password_enc ? '••••••••' : '—'}\n` +
    `Персона: ${esc(row.persona_name || '—')}\n` +
    `Инвайт TG: <b>@${esc(row.telegram_username || '—')}</b>\n` +
    `Dolphin profile: <code>${esc(row.dolphin_profile_id || '—')}</code>\n` +
    `Язык: ${esc(row.language || 'en')}\n` +
    `Таймер инвайта: ${esc(minsRange(row))} (${row.invite_after_min}–${row.invite_after_max} сек)\n` +
    `Статус: ${esc(row.status || 'idle')}${row.last_error ? `\nОшибка: <code>${esc(row.last_error)}</code>` : ''}\n` +
    `Включён: ${enabled ? 'да' : 'нет'}` +
    (row.persona_prompt
      ? `\n\nПромпт:\n<code>${esc(String(row.persona_prompt).slice(0, 400))}</code>`
      : '');

  const keyboard = [
    [
      {
        text: enabled ? '⏸ Выключить' : '▶️ Включить',
        callback_data: `adm:dt:t:${row.id}`,
      },
      { text: '💬 Инвайт', callback_data: `adm:dt:p:${row.id}` },
    ],
    [
      { text: '🌐 Язык', callback_data: `adm:dt:lang:${row.id}` },
      { text: '⏱ Таймер', callback_data: `adm:dt:timer:${row.id}` },
    ],
    [
      { text: '✏️ Сменить @TG', callback_data: `adm:dt:tg:${row.id}` },
      { text: '🔑 Пароль', callback_data: `adm:dt:pw:${row.id}` },
    ],
    [
      { text: '🐬 Dolphin ID', callback_data: `adm:dt:dolphin:${row.id}` },
      { text: '🗑 Удалить', callback_data: `adm:dt:del:${row.id}` },
    ],
    [{ text: '« К списку', callback_data: 'adm:dt' }],
  ];
  return { text: text.slice(0, 3900), reply_markup: { inline_keyboard: keyboard } };
}

function startAddWizard() {
  wizard = {
    until: Date.now() + INPUT_TTL_MS,
    step: 'login',
    data: { site: 'tagged' },
  };
  return {
    text:
      '<b>➕ Новый аккаунт Tagged</b>\n\n' +
      'Шаг 1/4 — пришли <b>логин / email</b> аккаунта на Tagged.',
    reply_markup: {
      inline_keyboard: [[{ text: 'Отмена', callback_data: 'adm:dt' }]],
    },
  };
}

function wizardPrompt() {
  if (!wizard) return null;
  const step = wizard.step;
  if (step === 'login') {
    return {
      text:
        '<b>➕ Новый аккаунт Tagged</b>\n\n' +
        'Шаг 1/4 — пришли <b>логин / email</b> аккаунта на Tagged.',
      reply_markup: { inline_keyboard: [[{ text: 'Отмена', callback_data: 'adm:dt' }]] },
    };
  }
  if (step === 'password') {
    return {
      text:
        `<b>➕ ${esc(wizard.data.login)}</b>\n\n` +
        'Шаг 2/4 — пришли <b>пароль</b> (сообщение потом можно удалить).',
      reply_markup: { inline_keyboard: [[{ text: 'Отмена', callback_data: 'adm:dt' }]] },
    };
  }
  if (step === 'tg') {
    return {
      text:
        'Шаг 3/4 — пришли <b>Telegram @username</b>, куда звать собеседника ' +
        '(без или с @).',
      reply_markup: { inline_keyboard: [[{ text: 'Отмена', callback_data: 'adm:dt' }]] },
    };
  }
  if (step === 'persona') {
    return {
      text:
        'Шаг 4/4 — пришли <b>имя персонажа</b> (или «-» чтобы взять из @username).\n' +
        'Опционально второй строкой — короткий промпт.',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Пропустить имя', callback_data: 'adm:dt:skip_persona' }],
          [{ text: 'Отмена', callback_data: 'adm:dt' }],
        ],
      },
    };
  }
  if (step === 'edit_tg' || step === 'edit_pw' || step === 'edit_dolphin') {
    return {
      text:
        step === 'edit_tg'
          ? `Пришли новый <b>@username</b> для #${wizard.editId}:`
          : step === 'edit_pw'
            ? `Пришли новый <b>пароль</b> для #${wizard.editId}:`
            : `Пришли <b>Dolphin profile id</b> для #${wizard.editId} (или «-» чтобы сбросить):`,
      reply_markup: {
        inline_keyboard: [[{ text: 'Отмена', callback_data: `adm:dt:v:${wizard.editId}` }]],
      },
    };
  }
  return null;
}

/**
 * Текст от админа, пока открыт мастер сайтов.
 * @returns {Promise<boolean>}
 */
async function handleText(api, chatId, text, tgSend) {
  if (!wizard || Date.now() > wizard.until) {
    clearWizard();
    return false;
  }
  if (String(text || '').startsWith('/')) {
    clearWizard();
    return false;
  }

  const raw = String(text || '').trim();
  wizard.until = Date.now() + INPUT_TTL_MS;

  try {
    if (wizard.step === 'login') {
      if (!raw || raw.length < 3) {
        await tgSend(api, chatId, 'Слишком короткий логин. Пришли email/логин ещё раз.');
        return true;
      }
      wizard.data.login = raw;
      wizard.step = 'password';
      await tgSend(api, chatId, null, wizardPrompt());
      return true;
    }

    if (wizard.step === 'password') {
      if (!raw) {
        await tgSend(api, chatId, 'Пароль пустой — пришли ещё раз.');
        return true;
      }
      wizard.data.password = raw;
      wizard.step = 'tg';
      await tgSend(api, chatId, null, wizardPrompt());
      return true;
    }

    if (wizard.step === 'tg') {
      const tg = store.normalizeTg(raw);
      if (!store.isValidTgUsername(tg)) {
        await tgSend(
          api,
          chatId,
          'Некорректный @username (5–32 символа, латиница/цифры/_). Попробуй ещё раз.',
        );
        return true;
      }
      wizard.data.telegram_username = tg;
      wizard.step = 'persona';
      await tgSend(api, chatId, null, wizardPrompt());
      return true;
    }

    if (wizard.step === 'persona') {
      const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const name = lines[0] === '-' ? '' : lines[0] || '';
      const prompt = lines.slice(1).join('\n');
      wizard.data.persona_name = name;
      wizard.data.persona_prompt = prompt;
      const ownerId = await resolveOwnerUserId(chatId);
      const row = await store.createAccount(ownerId, {
        ...wizard.data,
        language: 'en',
        invite_after_min: 180,
        invite_after_max: 240,
        is_enabled: true,
      });
      clearWizard();
      const view = await buildCardView(row.id, '✅ Аккаунт добавлен.');
      await tgSend(api, chatId, null, view);
      return true;
    }

    if (wizard.step === 'edit_tg') {
      const tg = store.normalizeTg(raw);
      if (!store.isValidTgUsername(tg)) {
        await tgSend(api, chatId, 'Некорректный @username. Ещё раз:');
        return true;
      }
      const id = wizard.editId;
      await store.updateAccount(id, { telegram_username: tg });
      clearWizard();
      const view = await buildCardView(id, `✅ TG обновлён: @${esc(tg)}`);
      await tgSend(api, chatId, null, view);
      return true;
    }

    if (wizard.step === 'edit_pw') {
      if (!raw) {
        await tgSend(api, chatId, 'Пароль пустой — пришли ещё раз.');
        return true;
      }
      const id = wizard.editId;
      await store.updateAccount(id, { password: raw });
      clearWizard();
      const view = await buildCardView(id, '✅ Пароль обновлён.');
      await tgSend(api, chatId, null, view);
      return true;
    }

    if (wizard.step === 'edit_dolphin') {
      const id = wizard.editId;
      const dolphin =
        raw === '-' || raw.toLowerCase() === 'none' || raw.toLowerCase() === 'сброс'
          ? null
          : store.normalizeDolphinId(raw);
      await store.updateAccount(id, { dolphin_profile_id: dolphin });
      clearWizard();
      const view = await buildCardView(
        id,
        dolphin ? `✅ Dolphin: <code>${esc(dolphin)}</code>` : '✅ Dolphin сброшен.',
      );
      await tgSend(api, chatId, null, view);
      return true;
    }
  } catch (err) {
    clearWizard();
    await tgSend(api, chatId, `❌ ${esc(err.message)}`);
    const view = await buildListView();
    await tgSend(api, chatId, null, view);
    return true;
  }

  return false;
}

/**
 * @param {object} api
 * @param {string} data callback_data
 * @param {object} target {chat_id, message_id, parse_mode, ...}
 * @param {(api, method, payload) => Promise<any>} tg
 */
async function handleCallback(api, data, target, tg) {
  if (data === 'adm:dt' || data === 'adm:dating') {
    clearWizard();
    const view = await buildListView();
    await tg(api, 'editMessageText', { ...target, ...view });
    return true;
  }

  if (data === 'adm:dt:add') {
    const view = startAddWizard();
    await tg(api, 'editMessageText', { ...target, ...view });
    return true;
  }

  if (data === 'adm:dt:skip_persona') {
    if (!wizard || wizard.step !== 'persona') {
      const view = await buildListView('Мастер устарел — начни заново.');
      await tg(api, 'editMessageText', { ...target, ...view });
      return true;
    }
    try {
      const ownerId = await resolveOwnerUserId(target.chat_id);
      const row = await store.createAccount(ownerId, {
        ...wizard.data,
        persona_name: '',
        persona_prompt: '',
        language: 'en',
        invite_after_min: 180,
        invite_after_max: 240,
        is_enabled: true,
      });
      clearWizard();
      const view = await buildCardView(row.id, '✅ Аккаунт добавлен.');
      await tg(api, 'editMessageText', { ...target, ...view });
    } catch (err) {
      clearWizard();
      const view = await buildListView(`❌ ${esc(err.message)}`);
      await tg(api, 'editMessageText', { ...target, ...view });
    }
    return true;
  }

  const siteMatch = data.match(/^adm:dt:site:tagged$/);
  if (siteMatch) {
    // совместимость со старыми кнопками — сразу к логину
    wizard = {
      until: Date.now() + INPUT_TTL_MS,
      step: 'login',
      data: { site: 'tagged' },
    };
    await tg(api, 'editMessageText', { ...target, ...wizardPrompt() });
    return true;
  }

  if (data === 'adm:dt:export') {
    try {
      const result = await store.exportWorker({});
      const view = await buildListView(
        `✅ Экспорт: <b>${result.count}</b> акк. → <code>${esc(result.file)}</code>`,
      );
      await tg(api, 'editMessageText', { ...target, ...view });
    } catch (err) {
      const view = await buildListView(`❌ Экспорт: ${esc(err.message)}`);
      await tg(api, 'editMessageText', { ...target, ...view });
    }
    return true;
  }

  if (data === 'adm:dt:preview') {
    const rows = await store.listAccounts({ enabledOnly: true });
    const sample = rows[0];
    const tgName = sample?.telegram_username || 'username';
    const lang = sample?.language || 'en';
    const phrase = store.invitePhrase(tgName, lang);
    const view = await buildListView(
      `💬 Пример инвайта (${esc(lang)}, @${esc(tgName)}):\n<i>${esc(phrase)}</i>`,
    );
    await tg(api, 'editMessageText', { ...target, ...view });
    return true;
  }

  const viewMatch = data.match(/^adm:dt:v:(\d+)$/);
  if (viewMatch) {
    clearWizard();
    const view = await buildCardView(viewMatch[1]);
    await tg(api, 'editMessageText', { ...target, ...view });
    return true;
  }

  const toggleMatch = data.match(/^adm:dt:t:(\d+)$/);
  if (toggleMatch) {
    const row = await store.getAccount(Number(toggleMatch[1]));
    if (!row) {
      await tg(api, 'editMessageText', {
        ...target,
        ...(await buildListView('❌ Не найден')),
      });
      return true;
    }
    const next = Number(row.is_enabled) === 1 ? 0 : 1;
    await store.updateAccount(row.id, { is_enabled: next });
    const view = await buildCardView(
      row.id,
      next ? '▶️ Включён' : '⏸ Выключен',
    );
    await tg(api, 'editMessageText', { ...target, ...view });
    return true;
  }

  const previewOne = data.match(/^adm:dt:p:(\d+)$/);
  if (previewOne) {
    const row = await store.getAccount(Number(previewOne[1]));
    if (!row) {
      await tg(api, 'editMessageText', {
        ...target,
        ...(await buildListView('❌ Не найден')),
      });
      return true;
    }
    const phrase = store.invitePhrase(row.telegram_username, row.language);
    const view = await buildCardView(
      row.id,
      `💬 Пример:\n<i>${esc(phrase)}</i>`,
    );
    await tg(api, 'editMessageText', { ...target, ...view });
    return true;
  }

  const langMatch = data.match(/^adm:dt:lang:(\d+)$/);
  if (langMatch) {
    const row = await store.getAccount(Number(langMatch[1]));
    if (!row) return true;
    const next = String(row.language || 'en').startsWith('ru') ? 'en' : 'ru';
    await store.updateAccount(row.id, { language: next });
    const view = await buildCardView(row.id, `🌐 Язык: <b>${next}</b>`);
    await tg(api, 'editMessageText', { ...target, ...view });
    return true;
  }

  const timerMatch = data.match(/^adm:dt:timer:(\d+)$/);
  if (timerMatch) {
    const row = await store.getAccount(Number(timerMatch[1]));
    if (!row) return true;
    // cycle: 2–3м → 3–4м → 4–5м → 5–7м → back
    const presets = [
      [120, 180],
      [180, 240],
      [240, 300],
      [300, 420],
    ];
    const cur = Number(row.invite_after_min) || 180;
    const idx = Math.max(
      0,
      presets.findIndex(([a]) => a === cur),
    );
    const next = presets[(idx + 1) % presets.length];
    await store.updateAccount(row.id, {
      invite_after_min: next[0],
      invite_after_max: next[1],
    });
    const view = await buildCardView(
      row.id,
      `⏱ Таймер: ${Math.round(next[0] / 60)}–${Math.round(next[1] / 60)} мин`,
    );
    await tg(api, 'editMessageText', { ...target, ...view });
    return true;
  }

  const tgEdit = data.match(/^adm:dt:tg:(\d+)$/);
  if (tgEdit) {
    wizard = {
      until: Date.now() + INPUT_TTL_MS,
      step: 'edit_tg',
      data: {},
      editId: Number(tgEdit[1]),
    };
    await tg(api, 'editMessageText', { ...target, ...wizardPrompt() });
    return true;
  }

  const pwEdit = data.match(/^adm:dt:pw:(\d+)$/);
  if (pwEdit) {
    wizard = {
      until: Date.now() + INPUT_TTL_MS,
      step: 'edit_pw',
      data: {},
      editId: Number(pwEdit[1]),
    };
    await tg(api, 'editMessageText', { ...target, ...wizardPrompt() });
    return true;
  }

  const dolphinEdit = data.match(/^adm:dt:dolphin:(\d+)$/);
  if (dolphinEdit) {
    wizard = {
      until: Date.now() + INPUT_TTL_MS,
      step: 'edit_dolphin',
      data: {},
      editId: Number(dolphinEdit[1]),
    };
    await tg(api, 'editMessageText', { ...target, ...wizardPrompt() });
    return true;
  }

  const delAsk = data.match(/^adm:dt:del:(\d+)$/);
  if (delAsk) {
    const id = delAsk[1];
    await tg(api, 'editMessageText', {
      ...target,
      text: `🗑 Удалить аккаунт сайта <b>#${esc(id)}</b>? Это необратимо.`,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Удалить', callback_data: `adm:dt:dx:${id}` },
            { text: 'Отмена', callback_data: `adm:dt:v:${id}` },
          ],
        ],
      },
    });
    return true;
  }

  const delDo = data.match(/^adm:dt:dx:(\d+)$/);
  if (delDo) {
    const ok = await store.deleteAccount(Number(delDo[1]));
    const view = await buildListView(
      ok ? `🗑 #${delDo[1]} удалён.` : '❌ Не найден.',
    );
    await tg(api, 'editMessageText', { ...target, ...view });
    return true;
  }

  return false;
}

function isDatingCallback(data) {
  return String(data || '').startsWith('adm:dt') || data === 'adm:dating';
}

function isWizardActive() {
  return Boolean(wizard && Date.now() <= wizard.until);
}

module.exports = {
  buildListView,
  handleCallback,
  handleText,
  isDatingCallback,
  isWizardActive,
  clearWizard,
};
