const tg = window.Telegram?.WebApp || null;

if (tg) {
  tg.ready();
  tg.expand();
}

function isTelegramWebApp() {
  return Boolean(tg && tg.initData);
}

function getTelegramUser() {
  if (!tg?.initDataUnsafe?.user) {
    return null;
  }

  return tg.initDataUnsafe.user;
}

console.log("Telegram WebApp available:", Boolean(tg));
console.log("Telegram initData exists:", Boolean(tg?.initData));
console.log("Telegram user:", getTelegramUser());
console.log("Will send Telegram initData to backend:", Boolean(tg?.initData));

// Относительный путь: фронт и API на одном домене через Nginx.
// Работает и локально (если открывать через тот же origin), и на проде (https://loverussian.duckdns.org/api).
const API_BASE = "/api";

/**
 * Универсальный запрос к backend.
 * Объекты в options.body автоматически преобразуются в JSON.
 */
async function request(path, options = {}) {
  const telegramInitData = tg?.initData || "";

  const requestOptions = {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      "X-Telegram-Init-Data": telegramInitData,
      ...options.headers,
    },
  };

  if (options.body !== undefined) {
    requestOptions.headers["Content-Type"] = "application/json";
    requestOptions.body = JSON.stringify(options.body);
  }

  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, requestOptions);
  } catch (error) {
    const networkError = new Error("Backend недоступен");
    networkError.isNetworkError = true;
    throw networkError;
  }

  const responseText = await response.text();
  let data = {};

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    throw new Error("Backend вернул не JSON");
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Ошибка запроса");
  }

  return data;
}

const api = {
  getDashboard: () => request('/dashboard'),

  getAccounts: () => request('/accounts'),

  addAccount: (phone, prompt) =>
    request('/accounts', {
      method: 'POST',
      body: { phone, prompt },
    }),

  connectStart: (phone) =>
    request('/accounts/connect/start', {
      method: 'POST',
      body: { phone },
    }),

  connectCode: (phone, code, prompt) =>
    request('/accounts/connect/code', {
      method: 'POST',
      body: { phone, code, prompt },
    }),

  connectPassword: (phone, password, prompt) =>
    request('/accounts/connect/password', {
      method: 'POST',
      body: { phone, password, prompt },
    }),

  updatePrompt: (id, prompt, replyDelayMin, replyDelayMax, mediaChatLink) =>
    request(`/accounts/${id}`, {
      method: 'PUT',
      body: { prompt, replyDelayMin, replyDelayMax, mediaChatLink },
    }),

  deleteAccount: (id) =>
    request(`/accounts/${id}`, {
      method: 'DELETE',
    }),

  startAi: (id) =>
    request(`/accounts/${id}/start-ai`, {
      method: 'POST',
    }),

  stopAi: (id) =>
    request(`/accounts/${id}/stop-ai`, {
      method: 'POST',
    }),

  getOptions: () => request('/options'),

  saveDelay: (delayMin, delayMax) =>
    request('/options/delay', {
      method: 'POST',
      body: { delayMin, delayMax },
    }),

  getBlacklist: () => request('/blacklist'),

  addBlacklist: (userId) =>
    request('/blacklist', {
      method: 'POST',
      body: { userId },
    }),

  clearBlacklist: () =>
    request('/blacklist', {
      method: 'DELETE',
    }),

  deleteBlacklistItem: (id) =>
    request(`/blacklist/${id}`, {
      method: 'DELETE',
    }),

  getExamples: () => request('/examples'),

  addExample: (data) =>
    request('/examples', {
      method: 'POST',
      body: data,
    }),

  getConversations: () => request('/accounts/conversations'),

  clearConversation: (accountId, peerId) =>
    request(`/accounts/conversations/${accountId}/${peerId}`, {
      method: 'DELETE',
    }),

  getStats: () => request('/stats'),
};

/**
 * Начальное состояние не содержит тестовых данных.
 * После загрузки страницы значения заменяются данными backend.
 */
const state = {
  activeTab: localStorage.getItem('currentTab') || 'panel',

  dashboard: {
    balance: 0,
    subscription: false,
    accountsUsed: 0,
    accountsLimit: 10,
    messages: 0,
  },

  accounts: [],
  examples: [],
  conversations: [],

  options: {
    delay: 15,
    min: 15,
    max: 25,
  },

  blacklist: [],

  stats: {
    messages: 0,
    referrals: 0,
    income: 0,
    accounts: 0,
  },
};

const elements = {
  pageTitle: document.getElementById('page-title'),
  tabs: Array.from(document.querySelectorAll('.nav-btn')),
  panels: Array.from(document.querySelectorAll('.tab-panel')),
  panelSummary: document.getElementById('panel-summary'),
  panelAccounts: document.getElementById('panel-accounts'),
  accountsList: document.getElementById('accounts-list'),
  accountForm: document.getElementById('account-form'),
  exampleForm: document.getElementById('example-form'),
  learnList: document.getElementById('learn-list'),
  conversationsList: document.getElementById('conversations-list'),
  exampleAccount: document.getElementById('example-account'),
  statsCards: document.getElementById('stats-cards'),
  statsAccounts: document.getElementById('stats-accounts'),
  optionsPreview: document.getElementById('options-preview'),
  delayInput: document.getElementById('delay-input'),
  minInput: document.getElementById('min-input'),
  maxInput: document.getElementById('max-input'),
  blacklistInput: document.getElementById('blacklist-input'),
  addBlacklist: document.getElementById('add-blacklist'),
  clearBlacklist: document.getElementById('clear-blacklist'),
};


/**
 * Защита значений, вставляемых в HTML.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatCurrency(value) {
  return `$${toNumber(value).toFixed(2)}`;
}

function showNotice(message) {
  const existing = document.querySelector('.notice');

  if (existing) {
    existing.remove();
  }

  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.textContent = message;

  const content = document.querySelector('.content');

  if (content) {
    content.prepend(notice);
  } else {
    document.body.prepend(notice);
  }

  setTimeout(() => {
    notice.remove();
  }, 2200);
}

function notify(message) {
  if (tg && typeof tg.showAlert === 'function') {
    try {
      tg.showAlert(message);
      return;
    } catch (error) {
      // Если Telegram alert недоступен, показываем обычное уведомление.
    }
  }

  showNotice(message);
}

function handleRequestError(error) {
  console.error(error);

  if (error?.isNetworkError || error?.message === 'Backend недоступен') {
    notify('Backend недоступен');
    return;
  }

  notify(error?.message || 'Пр����изошла ошибка');
}

/**
 * Получение массива из разных допустимых форматов JSON.
 */
function getResponseArray(response, key) {
  if (Array.isArray(response)) {
    return response;
  }

  if (Array.isArray(response?.[key])) {
    return response[key];
  }

  if (Array.isArray(response?.data)) {
    return response.data;
  }

  return [];
}

function isAiEnabled(account) {
  return (
    account.is_autoreply_enabled === true ||
    Number(account.is_autoreply_enabled) === 1 ||
    account.isAutoreplyEnabled === true ||
    account.status === 'AI включен'
  );
}

function getBlacklistUserId(item) {
  if (typeof item !== 'object' || item === null) {
    return item;
  }

  return (
    item.userId ??
    item.user_id ??
    item.telegram_user_id ??
    item.blocked_user_id ??
    ''
  );
}

function getExampleAccountId(example) {
  return example.accountId ?? example.account_id ?? null;
}

function getExampleAccountName(example) {
  const accountName =
    example.accountPhone ??
    example.account_phone ??
    example.phone ??
    example.account;

  if (accountName) {
    return accountName;
  }

  const accountId = getExampleAccountId(example);
  const account = state.accounts.find(
    (item) => String(item.id) === String(accountId),
  );

  return account?.phone || 'Аккаунт';
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  localStorage.setItem('currentTab', tabName);

  const titles = {
    panel: 'Панель',
    accounts: 'Аккаунты',
    learn: 'Учить',
    info: 'Инфо',
    options: 'Опции',
    stats: 'Статы',
  };

  if (elements.pageTitle) {
    elements.pageTitle.textContent = titles[tabName] || 'Панель';
  }

  elements.tabs.forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabName);
  });

  elements.panels.forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.panel === tabName);
  });
}

/**
 * Загрузка отдельных разделов API.
 */
async function loadDashboard() {
  const response = await api.getDashboard();
  const dashboard = response.dashboard || response.data || response;

  state.dashboard = {
    balance: toNumber(dashboard.balance),
    subscription: Boolean(dashboard.subscription),
    accountsUsed: toNumber(
      dashboard.accountsUsed ?? dashboard.accounts_used,
    ),
    accountsLimit: toNumber(
      dashboard.accountsLimit ?? dashboard.accounts_limit,
      10,
    ),
    messages: toNumber(dashboard.messages),
  };
}

async function loadAccounts() {
  const response = await api.getAccounts();
  state.accounts = getResponseArray(response, 'accounts');
}

async function loadOptions() {
  const response = await api.getOptions();
  const options =
    response.options ||
    response.settings ||
    response.data ||
    response;

  const delayMin = toNumber(
    options.delayMin ??
      options.delay_min ??
      options.min,
    15,
  );

  const delayMax = toNumber(
    options.delayMax ??
      options.delay_max ??
      options.max,
    25,
  );

  state.options = {
    delay: toNumber(
      options.delay ??
        options.delay_seconds ??
        delayMin,
      delayMin,
    ),
    min: delayMin,
    max: delayMax,
  };
}

async function loadBlacklist() {
  const response = await api.getBlacklist();
  state.blacklist = getResponseArray(response, 'blacklist');
}

async function loadExamples() {
  const response = await api.getExamples();
  state.examples = getResponseArray(response, 'examples');
}

async function loadConversations() {
  const response = await api.getConversations();
  state.conversations = getResponseArray(response, 'conversations');
}

async function loadStats() {
  const response = await api.getStats();
  const stats = response.stats || response.data || response;

  state.stats = {
    messages: toNumber(
      stats.messages ??
        stats.messagesCount ??
        stats.messages_count,
    ),
    referrals: toNumber(
      stats.referrals ??
        stats.referralsCount ??
        stats.referrals_count,
    ),
    income: toNumber(stats.income),
    accounts: toNumber(
      stats.accounts ??
        stats.accountsCount ??
        stats.accounts_count,
    ),
  };
}

/**
 * Загружает все основные данны��.
 * Promise.allSettled позволяет не ломать интерфейс,
 * даже если отдельный endpoint временно вернул ошибку.
 */
async function loadAllData() {
  const results = await Promise.allSettled([
    loadDashboard(),
    loadAccounts(),
    loadOptions(),
    loadBlacklist(),
    loadExamples(),
    loadConversations(),
    loadStats(),
  ]);

  render();

  const errors = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);

  if (!errors.length) {
    return true;
  }

  const networkError = errors.find(
    (error) =>
      error?.isNetworkError ||
      error?.message === 'Backend недоступен',
  );

  if (networkError) {
    notify('Backend недоступен');
  } else {
    handleRequestError(errors[0]);
  }

  return false;
}

function renderPanel() {
  if (!elements.panelSummary || !elements.panelAccounts) {
    return;
  }

  const {
    balance,
    subscription,
    accountsUsed,
    accountsLimit,
    messages,
  } = state.dashboard;

  elements.panelSummary.innerHTML = `
    <div class="stat-card">
      <strong>${accountsUsed}/${accountsLimit}</strong>
      <span>Аккаунты</span>
    </div>

    <div class="stat-card">
      <strong>${messages}</strong>
      <span>Сообщения</span>
    </div>

    <div class="stat-card">
      <strong>${formatCurrency(balance)}</strong>
      <span>Баланс</span>
    </div>

    <div class="stat-card">
      <strong>${subscription ? 'Да' : 'Нет'}</strong>
      <span>Подписка</span>
    </div>
  `;

  if (!state.accounts.length) {
    elements.panelAccounts.innerHTML = `
      <div class="empty-state">
        <h3>Аккаунтов пока нет</h3>
        <p>Добавьте первый Telegram-аккаунт, чтобы запустить AI-автоответчик</p>
        <button
          class="btn btn-primary"
          data-action="open-accounts"
          type="button"
        >
          Добавить аккаунт
        </button>
      </div>
    `;

    return;
  }

  elements.panelAccounts.innerHTML = state.accounts
    .map((account) => {
      const aiEnabled = isAiEnabled(account);

      const isOnline = !!account.is_online;

      return `
        <div class="account-item">
          <div class="account-item__head">
            <strong>
              <span
                class="online-dot ${isOnline ? 'is-online' : 'is-offline'}"
                title="${isOnline ? 'Подключён и слушает сообщения' : 'Не подключён'}"
              ></span>
              ${escapeHtml(account.phone)}
            </strong>
            <span class="badge ${aiEnabled ? 'success' : 'warn'}">
              ${escapeHtml(account.status || (aiEnabled ? 'AI включен' : 'Остановлен'))}
                </span>
              </div>

              <div class="action-row" style="margin-top:10px;">
                ${
                  aiEnabled
                    ? `
                      <button
                        class="btn btn-secondary"
                        data-action="stop"
                        data-id="${account.id}"
                        type="button"
                      >
                        Остановить
                      </button>
                    `
                    : `
                      <button
                        class="btn btn-primary"
                        data-action="ai"
                        data-id="${account.id}"
                        type="button"
                      >
                        Запустить AI
                      </button>
                    `
                }

                <button
                  class="btn btn-secondary"
                  data-action="details"
                  data-id="${account.id}"
                  type="button"
                >
                  Подробнее
                </button>

            <button
              class="btn btn-danger"
              data-action="delete"
              data-id="${account.id}"
              type="button"
            >
              Удалить
            </button>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderAccounts() {
  if (!elements.accountsList || !elements.exampleAccount) {
    return;
  }

  const usedAccounts = state.dashboard.accountsUsed;
  const accountsLimit = state.dashboard.accountsLimit;
  const availableAccounts = Math.max(accountsLimit - usedAccounts, 0);

  elements.accountsList.innerHTML = state.accounts.length
    ? state.accounts
        .map((account) => {
          const aiEnabled = isAiEnabled(account);

          return `
            <div class="account-item">
              <div class="account-item__head">
                <strong>${escapeHtml(account.phone)}</strong>
                <span class="badge ${aiEnabled ? 'success' : 'warn'}">
                  ${escapeHtml(account.status || (aiEnabled ? 'AI включен' : 'Остановлен'))}
                </span>
              </div>

              <p>${escapeHtml(account.prompt)}</p>

              <div class="action-row" style="margin-top:10px;">
                ${
                  aiEnabled
                    ? `
                      <button
                        class="btn btn-secondary"
                        data-action="stop"
                        data-id="${account.id}"
                        type="button"
                      >
                        Остановить
                      </button>
                    `
                    : `
                      <button
                        class="btn btn-primary"
                        data-action="ai"
                        data-id="${account.id}"
                        type="button"
                      >
                        Запустить AI
                      </button>
                    `
                }

                <button
                  class="btn btn-secondary"
                  data-action="details"
                  data-id="${account.id}"
                  type="button"
                >
                  Подробнее
                </button>

                <button
                  class="btn btn-danger"
                  data-action="delete"
                  data-id="${account.id}"
                  type="button"
                >
                  Удалить
                </button>
              </div>
            </div>
          `;
        })
        .join('')
    : `
      <div class="empty-state">
        <h3>Аккаунтов пока нет</h3>
        <p>Добавьте первый Telegram-аккаунт, чтобы начать работу.</p>
      </div>
    `;

  elements.exampleAccount.innerHTML = state.accounts.length
    ? state.accounts
        .map(
          (account) => `
            <option value="${account.id}">
              ${escapeHtml(account.phone)}
            </option>
          `,
        )
        .join('')
    : '<option value="">Сначала добавьте аккаунт</option>';

  const limitsContainer = document.getElementById('limits-values');

  if (limitsContainer) {
    limitsContainer.innerHTML = `
      <div>
        <strong>${usedAccounts}</strong>
        <p>Использовано</p>
      </div>

      <div>
        <strong>${availableAccounts}</strong>
        <p>Доступно</p>
      </div>
    `;
  }
}

function renderConversations() {
  if (!elements.conversationsList) {
    return;
  }

  if (!state.conversations.length) {
    elements.conversationsList.innerHTML = `
      <div class="empty-state">
        <h3>Диалогов пока нет</h3>
        <p>Здесь появятся переписки, как только AI начнёт отвечать людям.</p>
      </div>
    `;

    return;
  }

  elements.conversationsList.innerHTML = state.conversations
    .map((item) => {
      const accountId = item.accountId ?? item.account_id ?? '';
      const peerId = item.peerId ?? item.peer_id ?? '';
      const peerName =
        item.peerUsername ?? item.peer_username ?? peerId ?? 'Собеседник';
      const messageCount =
        item.messageCount ?? item.message_count ?? 0;
      const accountPhone =
        item.accountPhone ?? item.account_phone ?? '';

      return `
        <div class="lesson-item">
          <div class="lesson-item__head">
            <strong>${escapeHtml(peerName)}</strong>
            <span class="badge badge-soft">${escapeHtml(messageCount)} сообщ.</span>
          </div>

          <p><strong>Аккаунт:</strong> ${escapeHtml(accountPhone)}</p>

          <div class="action-row" style="margin-top:10px;">
            <button
              class="btn btn-danger"
              data-action="clear-history"
              data-account="${escapeHtml(accountId)}"
              data-peer="${escapeHtml(peerId)}"
              type="button"
            >
              Стереть историю с ${escapeHtml(peerName)}
            </button>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderLearn() {
  if (!elements.learnList) {
    return;
  }

  if (!state.examples.length) {
    elements.learnList.innerHTML = `
      <div class="empty-state">
        <h3>Диалоги появятся после первых AI-ответов</h3>
        <p>Сохраняйте удачные сценарии, чтобы улучшать ответы.</p>
      </div>
    `;

    return;
  }

  elements.learnList.innerHTML = state.examples
    .map((item) => {
      const clientMessage =
        item.clientMessage ??
        item.client_message ??
        item.client ??
        '';

      const correctAnswer =
        item.correctAnswer ??
        item.correct_answer ??
        item.reply ??
        '';

      return `
        <div class="lesson-item">
          <div class="lesson-item__head">
            <strong>${escapeHtml(getExampleAccountName(item))}</strong>
            <span class="badge badge-soft">Пример</span>
          </div>

          <p>
            <strong>Человек:</strong>
            ${escapeHtml(clientMessage)}
          </p>

          <p>
            <strong>Ответ:</strong>
            ${escapeHtml(correctAnswer)}
          </p>

          <p>
            <strong>Заметка:</strong>
            ${escapeHtml(item.note || 'Без заметки')}
          </p>
        </div>
      `;
    })
    .join('');
}

function renderBlacklist() {
  if (!elements.optionsPreview) {
    return;
  }

  const blacklistHtml = state.blacklist.length
    ? state.blacklist
        .map((item) => {
          const userId = getBlacklistUserId(item);
          const itemId =
            typeof item === 'object' && item !== null
              ? item.id
              : null;

          return `
            <span class="badge badge-soft">
              ${escapeHtml(userId)}
              ${
                itemId !== null && itemId !== undefined
                  ? `
                    <button
                      type="button"
                      data-action="delete-blacklist"
                      data-id="${itemId}"
                      aria-label="Удалить User ID"
                    >
                      ×
                    </button>
                  `
                  : ''
              }
            </span>
          `;
        })
        .join(' ')
    : 'Blacklist пуст';

  elements.optionsPreview.innerHTML = `
    <div class="option-item">
      <strong>Задержка</strong>
      <p>${state.options.delay} сек</p>
    </div>

    <div class="option-item">
      <strong>Диапазон</strong>
      <p>${state.options.min}–${state.options.max} сек</p>
    </div>

    <div class="option-item">
      <strong>Blacklist</strong>
      <p>${blacklistHtml}</p>
    </div>
  `;
}

function renderOptions() {
  if (elements.delayInput) {
    elements.delayInput.value = state.options.delay;
  }

  if (elements.minInput) {
    elements.minInput.value = state.options.min;
  }

  if (elements.maxInput) {
    elements.maxInput.value = state.options.max;
  }

  renderBlacklist();
}

function renderStats() {
  if (!elements.statsCards || !elements.statsAccounts) {
    return;
  }

  elements.statsCards.innerHTML = `
    <div class="stat-card">
      <strong>${state.stats.messages}</strong>
      <span>Сообщения</span>
    </div>

    <div class="stat-card">
      <strong>${state.stats.referrals}</strong>
      <span>Рефералы</span>
    </div>

    <div class="stat-card">
      <strong>${formatCurrency(state.stats.income)}</strong>
      <span>Доход</span>
    </div>

    <div class="stat-card">
      <strong>${state.stats.accounts}</strong>
      <span>Аккаунты</span>
    </div>
  `;

  elements.statsAccounts.innerHTML = state.accounts.length
    ? state.accounts
        .map((account) => {
          const aiEnabled = isAiEnabled(account);

          return `
            <div class="account-item">
              <div class="account-item__head">
                <strong>${escapeHtml(account.phone)}</strong>
                <span class="badge badge-soft">
                  ${escapeHtml(account.status || (aiEnabled ? 'AI включен' : 'Остановлен'))}
                </span>
              </div>
            </div>
          `;
        })
        .join('')
    : `
      <div class="empty-state">
        <h3>Статистика появится после первых сообщений</h3>
        <p>Как только аккаунты начнут работать, здесь появятся данные.</p>
      </div>
    `;
}

function render() {
  renderPanel();
  renderAccounts();
  renderConversations();
  renderLearn();
  renderOptions();
  renderStats();
  setActiveTab(state.activeTab);
}

/**
 * Состояние многошагового подключения аккаунта.
 * step: 'phone' -> 'code' -> 'password' -> сброс после успеха.
 */
const connectState = {
  step: 'phone',
  phone: '',
  prompt: '',
};

function setConnectHint(message) {
  const hint = document.getElementById('account-form-hint');
  if (!hint) return;

  if (message) {
    hint.textContent = message;
    hint.hidden = false;
  } else {
    hint.textContent = '';
    hint.hidden = true;
  }
}

/**
 * Переключает форму между шагами: показывает нужные поля и меняет кнопку.
 */
function setConnectStep(step) {
  connectState.step = step;

  const codeField = document.getElementById('account-code-field');
  const passwordField = document.getElementById('account-password-field');
  const phoneField = document.getElementById('account-phone');
  const submitButton = document.getElementById('account-submit');

  if (codeField) codeField.hidden = step !== 'code';
  if (passwordField) passwordField.hidden = step !== 'password';

  // Телефон нельзя менять после отправки кода.
  if (phoneField) phoneField.readOnly = step !== 'phone';

  if (submitButton) {
    const labels = {
      phone: 'Получить код',
      code: 'Подтвердить код',
      password: 'Подтвердить пароль',
    };
    submitButton.textContent = labels[step] || 'Продолжить';
  }
}

/**
 * Сбрасывает форму подключения в начальное состояние.
 */
function resetConnectForm() {
  connectState.step = 'phone';
  connectState.phone = '';
  connectState.prompt = '';

  const phoneField = document.getElementById('account-phone');
  const codeField = document.getElementById('account-code');
  const passwordField = document.getElementById('account-password');
  const promptField = document.getElementById('account-prompt');

  if (phoneField) {
    phoneField.value = '';
    phoneField.readOnly = false;
  }
  if (codeField) codeField.value = '';
  if (passwordField) passwordField.value = '';
  if (promptField) promptField.value = '';

  setConnectStep('phone');
  setConnectHint('');
}

/**
 * Завершение подключения: обновляем данные и сбрасываем форму.
 */
async function finishConnect() {
  await Promise.all([
    loadDashboard(),
    loadAccounts(),
  ]);

  resetConnectForm();
  render();
  notify('Аккаунт подключён');
}

/**
 * Обработчик формы подключения. Ведёт пользователя по шагам:
 * телефон -> код -> (пароль 2FA) -> успех.
 */
async function addAccount(event) {
  event.preventDefault();

  const submitButton = document.getElementById('account-submit');
  if (submitButton) submitButton.disabled = true;

  try {
    if (connectState.step === 'phone') {
      const phoneField = document.getElementById('account-phone');
      const phone = phoneField?.value.trim() || '';
      const promptField = document.getElementById('account-prompt');

      if (!phone) {
        notify('Введите номер телефона');
        return;
      }

      // Запоминаем промпт, введённый в форме, чтобы сохранить его
      // вместе с аккаунтом на финальном шаге подключения.
      connectState.prompt = promptField?.value.trim() || '';

      await api.connectStart(phone);
      connectState.phone = phone;
      setConnectStep('code');
      setConnectHint('Код отправлен в приложение Telegram. Введите его выше.');
      return;
    }

    if (connectState.step === 'code') {
      const code = document.getElementById('account-code')?.value.trim() || '';

      if (!code) {
        notify('Введите код из Telegram');
        return;
      }

      const result = await api.connectCode(
        connectState.phone,
        code,
        connectState.prompt,
      );

      if (result.status === 'needPassword') {
        setConnectStep('password');
        setConnectHint('Аккаунт защищён паролем. Введите облачный пароль (2FA).');
        return;
      }

      await finishConnect();
      return;
    }

    if (connectState.step === 'password') {
      const password = document.getElementById('account-password')?.value || '';

      if (!password) {
        notify('Введите облачный пароль');
        return;
      }

      await api.connectPassword(
        connectState.phone,
        password,
        connectState.prompt,
      );
      await finishConnect();
      return;
    }
  } catch (error) {
    handleRequestError(error);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

/**
 * Удаление Telegram-аккаунта.
 */
async function handleDelete(accountId) {
  try {
    await api.deleteAccount(accountId);

    await Promise.all([
      loadDashboard(),
      loadAccounts(),
      loadStats(),
    ]);

    render();
    notify('Аккаунт удалён');
  } catch (error) {
    handleRequestError(error);
  }
}

/**
 * Включение AI.
 */
async function handleAiToggle(accountId) {
  try {
    await api.startAi(accountId);

    await Promise.all([
      loadAccounts(),
      loadDashboard(),
      loadStats(),
    ]);

    render();
    notify('AI включен');
  } catch (error) {
    handleRequestError(error);
  }
}

/**
 * Остановка AI.
 */
async function handleStop(accountId) {
  try {
    await api.stopAi(accountId);

    await Promise.all([
      loadAccounts(),
      loadDashboard(),
      loadStats(),
    ]);

    render();
    notify('AI остановлен');
  } catch (error) {
    handleRequestError(error);
  }
}

/**
 * Сохранение обучающего примера.
 */
async function saveExample(event) {
  event.preventDefault();

  const accountId = document.getElementById('example-account')?.value || '';
  const clientMessage =
    document.getElementById('example-client')?.value.trim() || '';
  const correctAnswer =
    document.getElementById('example-reply')?.value.trim() || '';
  const note =
    document.getElementById('example-note')?.value.trim() || '';

  if (!accountId) {
    notify('Сначала добавьте аккаунт');
    return;
  }

  if (!clientMessage || !correctAnswer) {
    notify('Сообщение и ответ не должны быть пустыми');
    return;
  }

  try {
    await api.addExample({
      accountId: Number(accountId),
      clientMessage,
      correctAnswer,
      note,
    });

    await Promise.all([
      loadExamples(),
      loadStats(),
    ]);

    const clientField = document.getElementById('example-client');
    const replyField = document.getElementById('example-reply');
    const noteField = document.getElementById('example-note');

    if (clientField) {
      clientField.value = '';
    }

    if (replyField) {
      replyField.value = '';
    }

    if (noteField) {
      noteField.value = '';
    }

    render();
    notify('Пример сохранён');
  } catch (error) {
    handleRequestError(error);
  }
}

/**
 * Сохранение минимальной и максимальной задержки.
 */
async function handleSaveOptions() {
  const delayMin = toNumber(elements.minInput?.value, 15);
  const delayMax = toNumber(elements.maxInput?.value, 25);

  if (delayMin < 0 || delayMax < 0) {
    notify('Задержка не может быть отрицательной');
    return;
  }

  if (delayMin > delayMax) {
    notify('Минимум должен быть меньше или равен максимуму');
    return;
  }

  try {
    await api.saveDelay(delayMin, delayMax);
    await loadOptions();

    renderOptions();
    notify('Настройки сохранены');
  } catch (error) {
    handleRequestError(error);
  }
}

/**
 * Добавление User ID в blacklist.
 */
async function addToBlacklist() {
  const userId = elements.blacklistInput?.value.trim() || '';

  if (!userId) {
    notify('Введите User ID');
    return;
  }

  try {
    await api.addBlacklist(userId);
    await loadBlacklist();

    if (elements.blacklistInput) {
      elements.blacklistInput.value = '';
    }

    renderBlacklist();
    notify('User ID добавлен в blacklist');
  } catch (error) {
    handleRequestError(error);
  }
}

/**
 * Очистка всего blacklist.
 */
async function clearBlacklist() {
  try {
    await api.clearBlacklist();
    await loadBlacklist();

    renderBlacklist();
    notify('Blacklist очищен');
  } catch (error) {
    handleRequestError(error);
  }
}

/**
 * Удаление одного элемента blacklist.
 */
async function deleteBlacklistItem(itemId) {
  try {
    await api.deleteBlacklistItem(itemId);
    await loadBlacklist();

    renderBlacklist();
    notify('User ID удалён из blacklist');
  } catch (error) {
    handleRequestError(error);
  }
}

/**
 * Сохранение (обновление) промпта аккаунта.
 */
async function handleSavePrompt(id, prompt, replyDelayMin, replyDelayMax, mediaChatLink) {
  if (!id) {
    return;
  }

  try {
    await api.updatePrompt(id, prompt, replyDelayMin, replyDelayMax, mediaChatLink);
    await loadAccounts();

    render();
    notify('Настройки сохранены');
  } catch (error) {
    handleRequestError(error);
  }
}

/**
 * Стирание истории переписки с конкретным собеседником.
 */
async function handleClearHistory(accountId, peerId) {
  if (!accountId || !peerId) {
    return;
  }

  try {
    await api.clearConversation(accountId, peerId);
    await loadConversations();

    render();
    notify('История переписки стёрта');
  } catch (error) {
    handleRequestError(error);
  }
}

function updateOptionsPreview() {
  state.options.delay = toNumber(
    elements.delayInput?.value,
    state.options.delay,
  );

  state.options.min = toNumber(
    elements.minInput?.value,
    state.options.min,
  );

  state.options.max = toNumber(
    elements.maxInput?.value,
    state.options.max,
  );

  renderBlacklist();
}

/**
 * Обновление всех данных по кнопке "Обновить".
 */
async function handleRefresh() {
  const success = await loadAllData();

  if (success) {
    notify('Данные обновлены');
  }
}

/**
 * Закрывает и удаляет модально�� окно деталей, если оно открыто.
 */
function closeAccountModal() {
  const overlay = document.getElementById('account-modal');
  if (overlay) {
    overlay.remove();
  }
  document.removeEventListener('keydown', onModalKeydown);
  // Снимаем блокировку прокрутки фона и слушатель клавиатуры (см. handleDetails).
  document.body.classList.remove('modal-open');
  if (visualViewportHandler && window.visualViewport) {
    window.visualViewport.removeEventListener('resize', visualViewportHandler);
    visualViewportHandler = null;
  }
}

// Слушатель изменения видимой области (открытие/закрытие клавиатуры на телефоне).
let visualViewportHandler = null;

/**
 * Мобильная эргономика модалки: при фокусе на поле доводим его в видимую зону
 * после того, как телефон покажет клавиатуру, и держим его на виду при
 * изменении размера вьюпорта.
 */
function setupMobileKeyboardHandling(overlay) {
  const scrollFieldIntoView = (field) => {
    if (!field) return;
    // Ждём анимацию появления клавиатуры, иначе браузер прокрутит «в старую» геометрию.
    setTimeout(() => {
      try {
        field.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch (_) {
        field.scrollIntoView(false);
      }
    }, 320);
  };

  overlay.querySelectorAll('input, textarea').forEach((field) => {
    field.addEventListener('focus', () => scrollFieldIntoView(field));
  });

  if (window.visualViewport) {
    const syncViewportHeight = () => {
      // Telegram на iOS иногда игнорирует interactive-widget. Явно задаём
      // высоту overlay по фактической видимой области браузера.
      overlay.style.setProperty('--keyboard-viewport-height', `${window.visualViewport.height}px`);
    };

    syncViewportHeight();
    visualViewportHandler = () => {
      syncViewportHeight();
      const active = document.activeElement;
      if (
        active &&
        overlay.contains(active) &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
      ) {
        try {
          active.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } catch (_) {
          active.scrollIntoView(false);
        }
      }
    };
    window.visualViewport.addEventListener('resize', visualViewportHandler);
  }
}

function onModalKeydown(event) {
  if (event.key === 'Escape') {
    closeAccountModal();
  }
}

/**
 * Красивое модальное окно с подробностями аккаунта.
 * Показывает телефон, статус, состояние AI и позволяет
 * прямо здесь отредакти��овать и сохранить промпт.
 */
function handleDetails(accountId) {
  const account = state.accounts.find(
    (item) => String(item.id) === String(accountId),
  );

  if (!account) {
    return;
  }

  // Если уже открыто — закрываем прежнее.
  closeAccountModal();

  const aiEnabled = isAiEnabled(account);
  const statusText = account.status || (aiEnabled ? 'AI включен' : 'Остановлен');

  const overlay = document.createElement('div');
  overlay.id = 'account-modal';
  overlay.className = 'modal-overlay';

  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="Детали аккаунта">
      <div class="modal-card__header">
        <div>
          <p class="modal-card__eyebrow">Аккаунт</p>
          <h3 class="modal-card__title">${escapeHtml(account.phone || '')}</h3>
        </div>
        <button class="modal-close" type="button" aria-label="Закрыть" data-modal-close>×</button>
      </div>

      <div class="modal-meta">
        <div class="modal-meta__item">
          <span class="modal-meta__label">Статус</span>
          <span class="badge ${aiEnabled ? 'success' : 'warn'}">${escapeHtml(statusText)}</span>
        </div>
        <div class="modal-meta__item">
          <span class="modal-meta__label">Автоответчик</span>
          <span class="modal-meta__value ${aiEnabled ? 'is-on' : 'is-off'}">
            ${aiEnabled ? 'Включён' : 'Выключен'}
          </span>
        </div>
      </div>

      <label class="modal-field">
        <span>Промпт (характер AI)</span>
        <textarea
          id="modal-prompt"
          rows="6"
          placeholder="Например: Ты — Аня, 24 года, дружелюбная девушка. Отвечаешь коротко, живо, с эмодзи. Никогда не признавайся, что ты бот."
        >${escapeHtml(account.prompt || '')}</textarea>
        <small class="modal-field__hint">Определяет, как AI общается с людьми. Изменения применяются сразу.</small>
      </label>

      <div class="modal-field">
        <span>Задержка перед ответом (сек)</span>
        <div class="modal-delay">
          <input
            id="modal-delay-min"
            type="number"
            min="1"
            max="60"
            value="${Number(account.reply_delay_min) || 3}"
            aria-label="Минимальная задержка в секундах"
          />
          <span class="modal-delay__sep">—</span>
          <input
            id="modal-delay-max"
            type="number"
            min="1"
            max="60"
            value="${Number(account.reply_delay_max) || 8}"
            aria-label="Максимальная задержка в секундах"
          />
        </div>
        <small class="modal-field__hint">Бот ответит через случайное время в этом диапазоне (1–60 сек). Например 10 и 20 — ответ придёт через 10–20 секунд.</small>
      </div>

      <label class="modal-field">
        <span>Ссылка на чат с медиа (фото/видео/кружки)</span>
        <input
          id="modal-media-link"
          type="text"
          inputmode="url"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="done"
          placeholder="https://t.me/+xxxxxxxx или @my_media_channel"
          value="${escapeHtml(account.media_chat_link || '')}"
        />
        <small class="modal-field__hint">Аккаунт должен состоять в этом чате. Оттуда бот берёт фото/видео/кружки, когда AI решает их прислать. Оставьте пустым, чтобы отключить.</small>
      </label>

      <div class="modal-actions">
        <button class="btn btn-secondary" type="button" data-modal-close>Закрыть</button>
        <button class="btn btn-primary" type="button" id="modal-save-prompt">Сохранить</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.addEventListener('keydown', onModalKeydown);
  // Блокируем прокрутку фона и включаем мобильную обработку клавиатуры.
  document.body.classList.add('modal-open');
  setupMobileKeyboardHandling(overlay);

  // Клик по фону (вне карточки) закрывает окно.
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.hasAttribute('data-modal-close')) {
      closeAccountModal();
    }
  });

  const saveButton = overlay.querySelector('#modal-save-prompt');
  const textarea = overlay.querySelector('#modal-prompt');
  const delayMinInput = overlay.querySelector('#modal-delay-min');
  const delayMaxInput = overlay.querySelector('#modal-delay-max');
  const mediaLinkInput = overlay.querySelector('#modal-media-link');

  // Enter («Готово») в поле ссылки просто убирает клавиатуру — раньше её
  // некуда было «опустить». Учитываем IME-композицию, чтобы не сработать зря.
  if (mediaLinkInput) {
    mediaLinkInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.nativeEvent?.isComposing || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      mediaLinkInput.blur();
    });
  }

  if (saveButton && textarea) {
    saveButton.addEventListener('click', async () => {
      // Диапазон задержки: ограничиваем 1..60 и упорядочиваем min <= max.
      const clamp = (v, def) => {
        const n = Math.round(Number(v));
        if (!Number.isFinite(n)) return def;
        return Math.min(60, Math.max(1, n));
      };

      let delayMin = clamp(delayMinInput?.value, 3);
      let delayMax = clamp(delayMaxInput?.value, 8);
      if (delayMin > delayMax) {
        [delayMin, delayMax] = [delayMax, delayMin];
      }

      const mediaChatLink = (mediaLinkInput?.value || '').trim();

      saveButton.disabled = true;
      await handleSavePrompt(account.id, textarea.value, delayMin, delayMax, mediaChatLink);
      closeAccountModal();
    });
  }
}

function bindEvents() {
  elements.tabs.forEach((button) => {
    button.addEventListener('click', () => {
      setActiveTab(button.dataset.tab);
    });
  });

  if (elements.accountForm) {
    elements.accountForm.addEventListener('submit', addAccount);
  }

  if (elements.exampleForm) {
    elements.exampleForm.addEventListener('submit', saveExample);
  }

  if (elements.addBlacklist) {
    elements.addBlacklist.addEventListener('click', addToBlacklist);
  }

  if (elements.clearBlacklist) {
    elements.clearBlacklist.addEventListener('click', clearBlacklist);
  }

  [
    elements.delayInput,
    elements.minInput,
    elements.maxInput,
  ]
    .filter(Boolean)
    .forEach((input) => {
      input.addEventListener('input', updateOptionsPreview);
    });

  document.addEventListener('click', (event) => {
    const target = event.target.closest('button, [data-action]');

    if (!target) {
      return;
    }

    const action = target.dataset.action;
    const id = target.dataset.id;

    if (action === 'open-accounts') {
      setActiveTab('accounts');
      return;
    }

    if (action === 'refresh') {
      handleRefresh();
      return;
    }

    if (action === 'topup') {
      notify('Оплата будет подключена позже');
      return;
    }

    if (action === 'logout') {
      if (tg && typeof tg.close === 'function') {
        tg.close();
      }

      return;
    }

    if (action === 'save-options' || action === 'save-delay') {
      handleSaveOptions();
      return;
    }

    if (action === 'details') {
      handleDetails(id);
      return;
    }

    if (action === 'ai') {
      handleAiToggle(id);
      return;
    }

    if (action === 'stop') {
      handleStop(id);
      return;
    }

    if (action === 'delete') {
      handleDelete(id);
      return;
    }

    if (action === 'delete-blacklist') {
      deleteBlacklistItem(id);
      return;
    }

    if (action === 'clear-history') {
      handleClearHistory(target.dataset.account, target.dataset.peer);
    }
  });
}

/**
 * Основной запуск: биндим события, рисуем интерфейс
 * и подтягиваем реальные данные из backend.
 */
async function startApp() {
  bindEvents();
  render();
  await loadAllData();
}

/**
 * Экран-заглушка, когда приложение открыто НЕ в Telegram.
 * Показываем сообщение и даём кнопку "Продолжить для теста".
 */
function showTelegramGate() {
  const gate = document.getElementById('tg-gate');
  const shell = document.querySelector('.app-shell');

  if (gate) {
    gate.hidden = false;
  }

  if (shell) {
    shell.style.display = 'none';
  }

  const bypass = document.getElementById('tg-gate-bypass');

  if (bypass) {
    bypass.addEventListener(
      'click',
      () => {
        if (gate) {
          gate.hidden = true;
        }

        if (shell) {
          shell.style.display = '';
        }

        startApp();
      },
      { once: true },
    );
  }
}

/**
 * Точка входа. Если приложение открыто внутри Telegram
 * (есть initData) — запускаемся сразу. Иначе показываем
 * экран-заглушку с обходом для локальной разработки.
 */
/**
 * Пока на телефоне открыта клавиатура — прячем нижнюю навигацию,
 * иначе она перекрывает поле, в которое печатаешь (во всех вкладках).
 * Определяем по сжатию видимой области больше чем на 25%.
 */
function watchMobileKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;

  const baseHeight = vv.height;

  const sync = () => {
    const shrunk = vv.height < Math.max(baseHeight, window.innerHeight) * 0.75;
    document.body.classList.toggle('keyboard-open', shrunk);
  };

  vv.addEventListener('resize', sync);
  sync();
}

function initializeApp() {
  watchMobileKeyboard();

  if (isTelegramWebApp()) {
    startApp();
  } else {
    showTelegramGate();
  }
}

initializeApp();
