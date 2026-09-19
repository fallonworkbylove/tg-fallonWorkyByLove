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

  bulkStartAi: () =>
    request('/accounts/bulk/start-ai', {
      method: 'POST',
    }),

  bulkStopAi: () =>
    request('/accounts/bulk/stop-ai', {
      method: 'POST',
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

  getPhotoExceptions: () => request('/photo-exceptions'),

  addPhotoException: (chatIdentifier) =>
    request('/photo-exceptions', {
      method: 'POST',
      body: { chatIdentifier },
    }),

  clearPhotoExceptions: () =>
    request('/photo-exceptions', {
      method: 'DELETE',
    }),

  deletePhotoException: (id) =>
    request(`/photo-exceptions/${id}`, {
      method: 'DELETE',
    }),

  getExamples: () => request('/examples'),

  addExample: (data) =>
    request('/examples', {
      method: 'POST',
      body: data,
    }),

  updateExample: (id, data) =>
    request(`/examples/${id}`, {
      method: 'PUT',
      body: data,
    }),

  deleteExample: (id) =>
    request(`/examples/${id}`, {
      method: 'DELETE',
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
const ALLOWED_TABS = [
  'panel',
  'accounts',
  'learn',
  'profiles',
  'info',
  'options',
  'stats',
];

function resolveInitialTab() {
  try {
    const saved = localStorage.getItem('currentTab');
    if (ALLOWED_TABS.includes(saved)) return saved;
  } catch (_) {}
  return 'panel';
}

const state = {
  activeTab: resolveInitialTab(),

  dashboard: {
    accountsUsed: 0,
    accountsLimit: 10,
    messages: 0,
  },

  accounts: [],
  examples: [],
  conversations: [],

  blacklist: [],
  photoExceptions: [],

  stats: {
    messages: 0,
    accounts: 0,
    messagesByAccount: [],
  },

  profiles: [],
  profileEditingId: null,
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
  blacklistInput: document.getElementById('blacklist-input'),
  addBlacklist: document.getElementById('add-blacklist'),
  clearBlacklist: document.getElementById('clear-blacklist'),
  photoExceptionInput: document.getElementById('photo-exception-input'),
  addPhotoException: document.getElementById('add-photo-exception'),
  clearPhotoExceptions: document.getElementById('clear-photo-exceptions'),
  photoExceptionsList: document.getElementById('photo-exceptions-list'),
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

function shownDelayPair(min, max) {
  const a = Number(min);
  const b = Number(max);
  if (!Number.isFinite(a) || !Number.isFinite(b) || (a <= 8 && b <= 15)) return [25, 50];
  const low = Math.min(90, Math.max(8, Math.round(a)));
  const high = Math.min(90, Math.max(8, Math.round(b)));
  return low <= high ? [low, high] : [high, low];
}

function formatPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const normalized = digits.length === 11 && digits.startsWith('8')
    ? `7${digits.slice(1)}`
    : digits;
  if (normalized.length === 11 && normalized.startsWith('7')) {
    return `+7 ${normalized.slice(1, 4)} ${normalized.slice(4, 7)} ${normalized.slice(7, 9)} ${normalized.slice(9)}`;
  }
  const trimmed = String(value || '').trim();
  return trimmed || 'Аккаунт';
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

  notify(error?.message || 'Произошла ошибка');
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
    return formatPhone(accountName);
  }

  const accountId = getExampleAccountId(example);
  const account = state.accounts.find(
    (item) => String(item.id) === String(accountId),
  );

  return formatPhone(account?.phone);
}

function setActiveTab(tabName) {
  const nextTab = ALLOWED_TABS.includes(tabName) ? tabName : 'panel';
  state.activeTab = nextTab;

  try {
    localStorage.setItem('currentTab', nextTab);
  } catch (_) {}

  const titles = {
    panel: 'Панель',
    accounts: 'Аккаунты',
    learn: 'Учить',
    profiles: 'Анкеты',
    info: 'Инфо',
    options: 'Опции',
    stats: 'Статы',
  };

  if (elements.pageTitle) {
    elements.pageTitle.textContent = titles[nextTab] || 'Панель';
  }

  // Всегда берём актуальный DOM — кэш NodeList мог устареть.
  document.querySelectorAll('.nav-btn').forEach((button) => {
    const tab = button.dataset.tab;
    if (!tab) return;
    button.classList.toggle('active', tab === nextTab);
  });

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.panel === nextTab);
  });

  if (nextTab === 'profiles') {
    loadProfiles().catch((err) => {
      console.error('profiles load failed', err);
    });
  }
}

/**
 * Загрузка отдельных разделов API.
 */
async function loadDashboard() {
  const response = await api.getDashboard();
  const dashboard = response.dashboard || response.data || response;

  state.dashboard = {
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

async function loadBlacklist() {
  const response = await api.getBlacklist();
  state.blacklist = getResponseArray(response, 'blacklist');
}

async function loadPhotoExceptions() {
  const response = await api.getPhotoExceptions();
  state.photoExceptions = getResponseArray(response, 'chats');
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

  const messagesByAccount = Array.isArray(stats.messagesByAccount)
    ? stats.messagesByAccount
    : Array.isArray(stats.messages_by_account)
      ? stats.messages_by_account
      : [];

  state.stats = {
    messages: toNumber(
      stats.messages ??
        stats.messagesCount ??
        stats.messages_count,
    ),
    accounts: toNumber(
      stats.accounts ??
        stats.accountsCount ??
        stats.accounts_count,
    ),
    messagesByAccount,
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
    loadBlacklist(),
    loadPhotoExceptions(),
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
                title="${isOnline ? 'Подключён и слушает сообщения' : 'не подключён'}"
              ></span>
              ${escapeHtml(formatPhone(account.phone))}
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
                <strong>${escapeHtml(formatPhone(account.phone))}</strong>
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
              ${escapeHtml(formatPhone(account.phone))}
            </option>
          `,
        )
        .join('')
    : '<option value="">Сначала добавьте аккаунт</option>';

  if (editingExampleId) {
    const editing = state.examples.find(
      (example) => String(example.id) === String(editingExampleId),
    );
    const accountId = editing?.accountId ?? editing?.account_id;
    if (accountId != null) elements.exampleAccount.value = String(accountId);
  }

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
        <h3>Примеров пока нет</h3>
        <p>Сохраните фразу ниже, и бот будет опираться на неё в ответах этого аккаунта.</p>
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

      const exampleId = item.id ?? item.example_id ?? '';

      return `
        <div class="lesson-item">
          <div class="lesson-item__head">
            <strong>${escapeHtml(getExampleAccountName(item))}</strong>
            <div class="lesson-item__actions">
              <button
                class="btn btn-secondary small"
                type="button"
                data-action="edit-example"
                data-id="${escapeHtml(exampleId)}"
              >
                Изменить
              </button>
              <button
                class="btn btn-danger small"
                type="button"
                data-action="delete-example"
                data-id="${escapeHtml(exampleId)}"
              >
                Удалить
              </button>
            </div>
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
      <strong>Blacklist</strong>
      <p>${blacklistHtml}</p>
    </div>
  `;
}

function renderPhotoExceptions() {
  const container = elements.photoExceptionsList;

  if (!container) {
    return;
  }

  if (!state.photoExceptions.length) {
    container.innerHTML =
      '<p class="muted">Список пуст — распознавание фото работает для всех пользователей.</p>';
    return;
  }

  container.innerHTML = state.photoExceptions
    .map((item) => {
      const identifier = item?.chat_identifier ?? item?.chatIdentifier ?? '';
      const itemId = item?.id;

      return `
        <span class="badge badge-soft">
          ${escapeHtml(identifier)}
          ${
            itemId !== null && itemId !== undefined
              ? `
                <button
                  type="button"
                  data-action="delete-photo-exception"
                  data-id="${itemId}"
                  aria-label="Удалить чат из списка"
                >
                  ×
                </button>
              `
              : ''
          }
        </span>
      `;
    })
    .join(' ');
}

function renderOptions() {
  renderBlacklist();
  renderPhotoExceptions();
}

function renderStats() {
  if (!elements.statsCards || !elements.statsAccounts) {
    return;
  }

  const counts = new Map(
    (state.stats.messagesByAccount || []).map((row) => [
      String(row.id),
      toNumber(row.messages),
    ]),
  );

  elements.statsCards.innerHTML = `
    <div class="stat-card">
      <strong>${state.stats.messages}</strong>
      <span>Сообщения</span>
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
          const messageCount = counts.get(String(account.id)) || 0;

          return `
            <div class="account-item">
              <div class="account-item__head">
                <strong>${escapeHtml(formatPhone(account.phone))}</strong>
                <span class="badge badge-soft">
                  ${escapeHtml(account.status || (aiEnabled ? 'AI включен' : 'Остановлен'))}
                </span>
              </div>
              <p>${messageCount} сообщ.</p>
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
  try {
    renderPanel();
    renderAccounts();
    renderConversations();
    renderLearn();
    renderOptions();
    renderStats();
    renderProfiles();
  } catch (error) {
    console.error('render failed', error);
  }
  setActiveTab(state.activeTab || 'panel');
}

/**
 * API анкет (PHP) — отдельно от Node /api.
 */
const PROFILES_API = new URL('api.php', window.location.href).toString();

function landingBaseUrl() {
  // Всегда чистый абсолютный URL без ?v= из Mini App
  return `${window.location.origin}/landing.html`;
}

function landingLinkForProfile(id) {
  const profileId = String(id || '').replace(/\D/g, '');
  return `${landingBaseUrl()}?profile=${profileId}`;
}

function getWorkerTelegramId() {
  const user = getTelegramUser();
  return user?.id ? Number(user.id) : null;
}

async function profilesRequest(action, { method = 'GET', body = null, query = {} } = {}) {
  const url = new URL(PROFILES_API);
  url.searchParams.set('action', action);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const initData = tg?.initData || '';
  const workerId = getWorkerTelegramId();
  const headers = {
    Accept: 'application/json',
  };
  if (initData) {
    headers.Authorization = `Bearer ${initData}`;
    headers['X-Telegram-Init-Data'] = initData;
  }
  if (workerId) {
    headers['X-Worker-Id'] = String(workerId);
  }

  const options = { method, headers };
  if (body != null) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify({
      ...body,
      worker_id: body.worker_id ?? workerId,
      initData: body.initData ?? initData,
    });
  }

  const response = await fetch(url.toString(), options);
  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    const message = (data && data.error) || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function setProfilePhotoStatus(message, isError = false) {
  const el = document.getElementById('profile-photo-status');
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.style.color = isError ? '#fca5a5' : '';
}

async function uploadProfilePhotoFile(file) {
  if (!file) return null;

  const maxBytes = 20 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error('Файл больше 20 МБ');
  }

  const initData = tg?.initData || '';
  const workerId = getWorkerTelegramId();
  const url = new URL(PROFILES_API);
  url.searchParams.set('action', 'upload_photo');

  const form = new FormData();
  form.append('photo', file, file.name || 'photo.jpg');
  if (workerId) form.append('worker_id', String(workerId));
  if (initData) form.append('initData', initData);

  const headers = { Accept: 'application/json' };
  if (initData) {
    headers.Authorization = `Bearer ${initData}`;
    headers['X-Telegram-Init-Data'] = initData;
  }
  if (workerId) headers['X-Worker-Id'] = String(workerId);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: form,
  });

  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    throw new Error((data && data.error) || `HTTP ${response.status}`);
  }

  return data?.photo_url || null;
}

async function handleProfilePhotoFileChange(event) {
  const input = event.target;
  const file = input?.files?.[0];
  if (!file) return;

  setProfilePhotoStatus('Загрузка фото…');
  showProfilesError('');

  try {
    const photoUrl = await uploadProfilePhotoFile(file);
    if (!photoUrl) throw new Error('Сервер не вернул ссылку');
    const urlInput = document.getElementById('profile-photo');
    if (urlInput) urlInput.value = photoUrl;
    updateProfilePhotoPreview();
    setProfilePhotoStatus('Фото загружено ✅');
    showAppSnackbar('Фото загружено ✅');
  } catch (err) {
    setProfilePhotoStatus(`Не удалось загрузить: ${err.message}`, true);
    showProfilesError(`Загрузка фото: ${err.message}`);
  } finally {
    if (input) input.value = '';
  }
}

function showProfilesError(message) {
  const el = document.getElementById('profiles-error');
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function showAppSnackbar(text) {
  const el = document.getElementById('app-snackbar');
  if (!el) return;
  el.textContent = text || 'Сохранено ✅';
  el.hidden = false;
  clearTimeout(showAppSnackbar._timer);
  showAppSnackbar._timer = setTimeout(() => {
    el.hidden = true;
  }, 2200);
}

async function loadProfiles() {
  const workerId = getWorkerTelegramId();
  showProfilesError('');

  if (!workerId) {
    showProfilesError('Нет Telegram user.id. Откройте Mini App из бота.');
    state.profiles = [];
    renderProfiles();
    return;
  }

  try {
    const data = await profilesRequest('get_worker_profiles', {
      query: { worker_id: workerId },
    });
    state.profiles = Array.isArray(data) ? data : [];
    renderProfiles();
  } catch (err) {
    state.profiles = [];
    renderProfiles();
    if (err.status === 403) {
      showProfilesError('Воркер не найден в таблице workers. Добавьте свой Telegram id.');
    } else if (err.status === 401) {
      showProfilesError(`Ошибка авторизации: ${err.message}`);
    } else {
      showProfilesError(`Не удалось загрузить анкеты: ${err.message}`);
    }
  }
}

function renderProfiles() {
  const list = document.getElementById('profiles-list');
  if (!list) return;

  const items = state.profiles || [];
  if (!items.length) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>Анкет пока нет</h3>
        <p>Создайте первую анкету, чтобы получить ссылку на лендинг.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = items
    .map((profile) => {
      const active = Number(profile.active) === 1;
      const photo = String(profile.photo_url || '').trim();
      const thumb = photo
        ? `<img class="profile-thumb" src="${escapeHtml(photo)}" alt="" loading="lazy" />`
        : `<div class="profile-thumb profile-thumb-fallback">👤</div>`;

      return `
        <div class="card" data-profile-id="${profile.id}">
          <div class="profile-card-row">
            ${thumb}
            <div class="profile-card-meta">
              <h4>${escapeHtml(profile.name || 'Без имени')}, ${escapeHtml(profile.age || '—')}</h4>
              <p>${escapeHtml(profile.city || 'Город не указан')}</p>
              <p style="margin-top:6px;">
                ${active ? '🟢 Активна' : '🔴 Выключена'}
                · переходы: <strong>${Number(profile.clicks) || 0}</strong>
              </p>
            </div>
          </div>
          <div class="action-row" style="margin-top:10px;">
            <button class="btn btn-secondary" type="button" data-profile-action="copy" data-id="${profile.id}">Ссылка</button>
            <button class="btn btn-primary" type="button" data-profile-action="edit" data-id="${profile.id}">Изменить</button>
            <button class="btn btn-danger" type="button" data-profile-action="delete" data-id="${profile.id}">Удалить</button>
          </div>
        </div>
      `;
    })
    .join('');
}

function showProfileForm(profile = null) {
  const card = document.getElementById('profile-form-card');
  const title = document.getElementById('profile-form-title');
  if (!card) return;

  card.hidden = false;
  state.profileEditingId = profile?.id || null;
  if (title) title.textContent = profile ? `Редактирование #${profile.id}` : 'Новая анкета';

  document.getElementById('profile-id').value = profile?.id || '';
  document.getElementById('profile-name').value = profile?.name || '';
  document.getElementById('profile-age').value = profile?.age || '';
  document.getElementById('profile-city').value = profile?.city || '';
  document.getElementById('profile-bio').value = profile?.bio || '';
  document.getElementById('profile-tg').value = profile?.tg_link || '';
  document.getElementById('profile-photo').value = profile?.photo_url || '';
  document.getElementById('profile-active').checked = profile ? Number(profile.active) === 1 : true;
  const fileInput = document.getElementById('profile-photo-file');
  if (fileInput) fileInput.value = '';
  setProfilePhotoStatus('');
  updateProfilePhotoPreview();
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideProfileForm() {
  const card = document.getElementById('profile-form-card');
  if (card) card.hidden = true;
  state.profileEditingId = null;
  document.getElementById('profile-form')?.reset();
  const activeInput = document.getElementById('profile-active');
  if (activeInput) activeInput.checked = true;
  const fileInput = document.getElementById('profile-photo-file');
  if (fileInput) fileInput.value = '';
  setProfilePhotoStatus('');
  updateProfilePhotoPreview();
}

function updateProfilePhotoPreview() {
  const input = document.getElementById('profile-photo');
  const img = document.getElementById('profile-photo-preview');
  if (!input || !img) return;
  const url = input.value.trim();
  if (!url) {
    img.hidden = true;
    img.removeAttribute('src');
    return;
  }
  img.hidden = false;
  img.src = url;
}

async function saveProfileForm(event) {
  event.preventDefault();
  showProfilesError('');

  const name = document.getElementById('profile-name').value.trim();
  const age = Number(document.getElementById('profile-age').value);
  const city = document.getElementById('profile-city').value.trim();
  const bio = document.getElementById('profile-bio').value.trim();
  const tgLink = document.getElementById('profile-tg').value.trim();
  const photoUrl = document.getElementById('profile-photo').value.trim();
  const active = document.getElementById('profile-active').checked ? 1 : 0;
  const idRaw = document.getElementById('profile-id').value.trim();
  const id = idRaw ? Number(idRaw) : null;
  const workerId = getWorkerTelegramId();

  if (!name || !Number.isFinite(age) || age < 18 || age > 45) {
    showProfilesError('Укажите имя и возраст 18–45.');
    return;
  }

  const payload = {
    name,
    age,
    city,
    bio,
    tg_link: tgLink,
    photo_url: photoUrl,
    active,
    worker_id: workerId,
  };
  if (id) payload.id = id;

  const submit = document.getElementById('profile-submit');
  if (submit) submit.disabled = true;

  try {
    await profilesRequest('save_profile', { method: 'POST', body: payload });
    showAppSnackbar('Сохранено ✅');
    hideProfileForm();
    await loadProfiles();
  } catch (err) {
    showProfilesError(`Сохранение не удалось: ${err.message}`);
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function deleteProfileById(id) {
  if (!window.confirm(`Удалить анкету #${id}?`)) return;
  try {
    await profilesRequest('delete_profile', {
      method: 'POST',
      query: { id },
      body: { id },
    });
    showAppSnackbar('Удалено ✅');
    await loadProfiles();
  } catch (err) {
    showProfilesError(`Удаление не удалось: ${err.message}`);
  }
}

async function copyProfileLink(id) {
  const link = landingLinkForProfile(id);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
    } else {
      const ta = document.createElement('textarea');
      ta.value = link;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    showAppSnackbar('Ссылка скопирована ✅');
    if (tg && typeof tg.showPopup === 'function') {
      tg.showPopup({
        title: 'Ссылка на лендинг',
        message: link,
        buttons: [{ type: 'close', text: 'OK' }],
      });
    } else if (tg && typeof tg.showAlert === 'function') {
      tg.showAlert(link);
    }
  } catch (_) {
    showAppSnackbar(link);
    if (tg && typeof tg.showAlert === 'function') {
      tg.showAlert(link);
    }
  }
}

function bindProfileEvents() {
  document.getElementById('profile-create-btn')?.addEventListener('click', () => {
    showProfileForm(null);
  });
  document.getElementById('profile-refresh-btn')?.addEventListener('click', () => {
    loadProfiles().catch((err) => console.error(err));
  });
  document.getElementById('profile-cancel')?.addEventListener('click', hideProfileForm);
  document.getElementById('profile-form')?.addEventListener('submit', saveProfileForm);
  document.getElementById('profile-photo')?.addEventListener('input', updateProfilePhotoPreview);
  document.getElementById('profile-photo-file')?.addEventListener('change', handleProfilePhotoFileChange);

  document.getElementById('profiles-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-profile-action]');
    if (!button) return;
    const id = Number(button.dataset.id);
    const action = button.dataset.profileAction;
    const profile = state.profiles.find((item) => Number(item.id) === id);

    if (action === 'edit' && profile) showProfileForm(profile);
    if (action === 'delete') deleteProfileById(id);
    if (action === 'copy') copyProfileLink(id);
  });
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
    try {
      await Promise.all([loadAccounts(), loadDashboard(), loadStats()]);
      render();
    } catch (_) {}
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

async function handleBulkAiToggle(enabled) {
  const actionLabel = enabled ? 'включить AI на всех аккаунтах' : 'выключить AI на всех аккаунтах';
  if (!window.confirm(`Точно ${actionLabel}?`)) return;

  try {
    if (enabled) {
      await api.bulkStartAi();
    } else {
      await api.bulkStopAi();
    }

    await Promise.all([loadAccounts(), loadDashboard(), loadStats()]);
    render();
    notify(enabled ? 'AI включен на всех аккаунтах' : 'AI выключен на всех аккаунтах');
  } catch (error) {
    try {
      await Promise.all([loadAccounts(), loadDashboard(), loadStats()]);
      render();
    } catch (_) {}
    handleRequestError(error);
  }
}

let editingExampleId = null;

function resetExampleForm() {
  editingExampleId = null;
  const title = document.getElementById('example-form-title');
  const submit = document.getElementById('example-submit');
  const clientField = document.getElementById('example-client');
  const replyField = document.getElementById('example-reply');
  const noteField = document.getElementById('example-note');
  const cancel = document.getElementById('example-cancel');
  if (title) title.textContent = 'Новый пример';
  if (submit) submit.textContent = 'Сохранить пример';
  if (cancel) cancel.hidden = true;
  if (clientField) clientField.value = '';
  if (replyField) replyField.value = '';
  if (noteField) noteField.value = '';
}

function editExample(id) {
  const item = state.examples.find((example) => String(example.id) === String(id));
  if (!item) return;

  editingExampleId = item.id;
  const accountField = document.getElementById('example-account');
  const clientField = document.getElementById('example-client');
  const replyField = document.getElementById('example-reply');
  const noteField = document.getElementById('example-note');
  const title = document.getElementById('example-form-title');
  const submit = document.getElementById('example-submit');
  const accountId = item.accountId ?? item.account_id;

  if (accountField && accountId != null) accountField.value = String(accountId);
  if (clientField) clientField.value = item.clientMessage ?? item.client_message ?? '';
  if (replyField) replyField.value = item.correctAnswer ?? item.correct_answer ?? '';
  if (noteField) noteField.value = item.note || '';
  const cancel = document.getElementById('example-cancel');
  if (title) title.textContent = 'Изменить пример';
  if (submit) submit.textContent = 'Сохранить изменения';
  if (cancel) cancel.hidden = false;

  document.getElementById('example-form')?.scrollIntoView({ block: 'start' });
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

  const payload = {
    accountId: Number(accountId),
    clientMessage,
    correctAnswer,
    note,
  };

  try {
    if (editingExampleId) {
      await api.updateExample(editingExampleId, payload);
    } else {
      await api.addExample(payload);
    }

    await Promise.all([
      loadExamples(),
      loadStats(),
    ]);

    const wasEdit = Boolean(editingExampleId);
    resetExampleForm();
    render();
    notify(wasEdit ? 'Пример изменён' : 'Пример сохранён');
  } catch (error) {
    handleRequestError(error);
  }
}

/**
 * Удаление примера из вкладки «Учить». После удаления бот больше его не использует.
 */
async function deleteExample(id) {
  if (id === null || id === undefined || id === '') return;

  try {
    await api.deleteExample(id);
    if (String(editingExampleId) === String(id)) resetExampleForm();
    await loadExamples();
    render();
    notify('Пример удалён');
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

/**
 * Удаление одной записи из blacklist.
 */
async function deleteBlacklistItem(id) {
  if (id === null || id === undefined) {
    return;
  }

  try {
    await api.deleteBlacklistItem(id);
    await loadBlacklist();

    render();
    notify('Запись удалена из blacklist');
  } catch (error) {
    handleRequestError(error);
  }
}

/**
 * Удаление одного пользователя из списка исключений распознавания фото.
 */
async function deletePhotoExceptionItem(id) {
  if (id === null || id === undefined) {
    return;
  }

  try {
    await api.deletePhotoException(id);
    await loadPhotoExceptions();

    render();
    notify('Пользователь удалён из списка исключений');
  } catch (error) {
    handleRequestError(error);
  }
}

/**
 * Добавление пользователя (ID или username) в список исключений
 * распознавания фото — применяется для всех сессий (аккаунтов).
 */
async function handleAddPhotoException() {
  const rawValue = elements.photoExceptionInput?.value?.trim();

  if (!rawValue) {
    notify('Введите ID или username пользователя');
    return;
  }

  try {
    await api.addPhotoException(rawValue);
    await loadPhotoExceptions();

    if (elements.photoExceptionInput) {
      elements.photoExceptionInput.value = '';
    }

    render();
    notify('Пользователь добавлен в список исключений');
  } catch (error) {
    handleRequestError(error);
  }
}

/**
 * Полная очистка списка исключений распознавания фото.
 */
async function handleClearPhotoExceptions() {
  try {
    await api.clearPhotoExceptions();
    await loadPhotoExceptions();

    render();
    notify('Список исключений очищен');
  } catch (error) {
    handleRequestError(error);
  }
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
 * Закрывает и удаляет модальное окно деталей, если оно открыто.
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
          <h3 class="modal-card__title">${escapeHtml(formatPhone(account.phone))}</h3>
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
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            enterkeyhint="done"
            autocomplete="off"
            value="${shownDelayPair(account.reply_delay_min, account.reply_delay_max)[0]}"
            aria-label="Минимальная задержка в секундах"
          />
          <span class="modal-delay__sep">—</span>
          <input
            id="modal-delay-max"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            enterkeyhint="done"
            autocomplete="off"
            value="${shownDelayPair(account.reply_delay_min, account.reply_delay_max)[1]}"
            aria-label="Максимальная задержка в секундах"
          />
        </div>
        <small class="modal-field__hint">Случайная пауза перед ответом, 8–90 секунд. Короткие значения вроде 3–8 больше не используются.</small>
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
        const n = Math.round(Number(String(v || '').replace(/\D/g, '')));
        if (!Number.isFinite(n) || n === 0) return def;
        return Math.min(90, Math.max(8, n));
      };

      let delayMin = clamp(delayMinInput?.value, 25);
      let delayMax = clamp(delayMaxInput?.value, 50);
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
    button.addEventListener('click', (event) => {
      if (!button.dataset.tab) {
        return;
      }
      event.preventDefault();
      setActiveTab(button.dataset.tab);
    });
  });

  bindProfileEvents();

  if (elements.accountForm) {
    elements.accountForm.addEventListener('submit', addAccount);
  }

  if (elements.exampleForm) {
    elements.exampleForm.addEventListener('submit', saveExample);
  }

  document.getElementById('example-cancel')?.addEventListener('click', resetExampleForm);

  if (elements.addBlacklist) {
    elements.addBlacklist.addEventListener('click', addToBlacklist);
  }

  if (elements.clearBlacklist) {
    elements.clearBlacklist.addEventListener('click', clearBlacklist);
  }

  if (elements.addPhotoException) {
    elements.addPhotoException.addEventListener('click', handleAddPhotoException);
  }

  if (elements.clearPhotoExceptions) {
    elements.clearPhotoExceptions.addEventListener('click', handleClearPhotoExceptions);
  }

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

    if (action === 'logout') {
      if (tg && typeof tg.close === 'function') {
        tg.close();
      }

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

    if (action === 'bulk-start') {
      handleBulkAiToggle(true);
      return;
    }

    if (action === 'bulk-stop') {
      handleBulkAiToggle(false);
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

    if (action === 'delete-photo-exception') {
      deletePhotoExceptionItem(id);
      return;
    }

    if (action === 'edit-example') {
      editExample(id);
      return;
    }

    if (action === 'delete-example') {
      deleteExample(id);
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
  try {
    bindEvents();
    render();
    await loadAllData();
  } catch (error) {
    console.error('startApp failed', error);
    setActiveTab('panel');
    notify(error?.message || 'Ошибка загрузки интерфейса');
  }
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
