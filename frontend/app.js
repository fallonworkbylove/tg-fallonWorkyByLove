/** Актуальный WebApp: Desktop иногда поднимает объект после первого тика. */
function getTg() {
  return window.Telegram?.WebApp || null;
}

let tg = getTg();
let themeListenerBound = false;

/** Яркость #RRGGBB 0..1 — чтобы не ставить светлый текст на светлый фон. */
function cssLuma(hex) {
  const m = String(hex || '').match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function applyTelegramChrome(webApp) {
  if (!webApp) return;
  try {
    webApp.ready();
    webApp.expand();
    const tp = webApp.themeParams || {};
    const header = tp.header_bg_color || tp.bg_color || '#0b0d10';
    const bg = tp.bg_color || '#0b0d10';
    if (typeof webApp.setHeaderColor === 'function') webApp.setHeaderColor(header);
    if (typeof webApp.setBackgroundColor === 'function') webApp.setBackgroundColor(bg);

    // Тему Telegram подмешиваем только если фон тёмный.
    // Текст/muted — только если достаточно светлые (иначе тёмный text на наших
    // тёмных карточках → «пропал текст» в списке аккаунтов).
    const root = document.documentElement;
    const bgLuma = cssLuma(tp.bg_color);
    if (bgLuma != null && bgLuma < 0.45) {
      if (tp.bg_color) root.style.setProperty('--bg', tp.bg_color);
      if (tp.secondary_bg_color) root.style.setProperty('--bg-elevated', tp.secondary_bg_color);
      if (tp.section_bg_color || tp.secondary_bg_color) {
        root.style.setProperty('--card', tp.section_bg_color || tp.secondary_bg_color);
      }
      const textLuma = cssLuma(tp.text_color);
      if (tp.text_color && textLuma != null && textLuma >= 0.55) {
        root.style.setProperty('--text', tp.text_color);
      }
      const mutedLuma = cssLuma(tp.hint_color);
      if (tp.hint_color && mutedLuma != null && mutedLuma >= 0.35) {
        root.style.setProperty('--muted', tp.hint_color);
      }
      // Акцент всегда наш кислотный — button_color Telegram часто голубой.
      root.style.setProperty('--primary', '#b8ff3c');
      root.style.setProperty('--primary-strong', '#86e000');
      root.style.setProperty('--primary-soft', 'rgba(184, 255, 60, 0.14)');
      root.style.setProperty('--acid', '#b8ff3c');
      if (tp.destructive_text_color) root.style.setProperty('--danger', tp.destructive_text_color);
    }

    // Один раз! Повторный onEvent на каждый apply → лавина колбэков и зависание WebView.
    if (!themeListenerBound && typeof webApp.onEvent === 'function') {
      themeListenerBound = true;
      webApp.onEvent('themeChanged', () => applyTelegramChrome(getTg()));
    }
  } catch (_) {
    /* старые клиенты Telegram */
  }
}

applyTelegramChrome(tg);

function isTelegramWebApp() {
  // Desktop часто кладёт initData в hash, а не в WebApp.initData на первом кадре.
  return Boolean(resolveTelegramInitData());
}

/** Есть оболочка Mini App (Desktop/Mobile), даже если initData ещё пустой. */
function isTelegramShell() {
  const w = getTg();
  // Реальные признаки WebView Telegram — НЕ w.version (CDN telegram-web-app.js
  // всегда выставляет version даже в обычном браузере → gate ломался).
  if (w?.initData) return true;
  if (typeof window.TelegramWebviewProxy !== 'undefined') return true;
  try {
    if (window.external && typeof window.external.notify === 'function') return true;
  } catch (_) {}
  const ua = String(navigator.userAgent || '');
  if (/Telegram/i.test(ua)) return true;
  const href = String(location.hash || '') + String(location.search || '');
  if (/tgWebAppData=/i.test(href)) return true;
  if (!w) return false;
  const platform = String(w.platform || '').toLowerCase();
  if (platform && platform !== 'unknown') return true;
  return false;
}

function getTelegramUser() {
  const w = getTg();
  if (!w?.initDataUnsafe?.user) {
    return null;
  }

  return w.initDataUnsafe.user;
}

/**
 * Desktop иногда не кладёт initData в WebApp, но передаёт в hash:
 * #tgWebAppData=user%3D%7B...%7D%26auth_date%3D...&tgWebAppVersion=...
 */
function initDataFromLocation() {
  const raw = `${location.hash || ''}${location.search || ''}`;
  if (!raw) return '';
  const fromHash = raw.match(/[#&?]tgWebAppData=([^&]+)/i);
  if (fromHash?.[1]) {
    try {
      return decodeURIComponent(fromHash[1]);
    } catch (_) {
      return fromHash[1];
    }
  }
  // Иногда весь query уже urlencoded целиком
  const m2 = raw.match(/tgWebAppData=([^&]+)/i);
  if (!m2?.[1]) return '';
  try {
    return decodeURIComponent(m2[1]);
  } catch (_) {
    return m2[1];
  }
}

function resolveTelegramInitData() {
  const fromTg = String(getTg()?.initData || '').trim();
  if (fromTg) return fromTg;
  const fromUrl = String(initDataFromLocation() || '').trim();
  if (fromUrl) return fromUrl;
  try {
    const cached = sessionStorage.getItem('tg_init_data');
    if (!cached) return '';
    const authDate = Number(new URLSearchParams(cached).get('auth_date') || 0);
    if (authDate) {
      const age = Math.floor(Date.now() / 1000) - authDate;
      if (age > 20 * 3600 || age < -300) {
        sessionStorage.removeItem('tg_init_data');
        return '';
      }
    }
    return cached;
  } catch (_) {}
  return '';
}

function isInitDataFresh(data) {
  try {
    const authDate = Number(new URLSearchParams(data).get('auth_date') || 0);
    if (!authDate) return true;
    const age = Math.floor(Date.now() / 1000) - authDate;
    return age <= 20 * 3600 && age >= -300;
  } catch (_) {
    return true;
  }
}

function cacheInitDataIfAny() {
  const data = resolveTelegramInitData();
  if (!data) return '';
  if (!isInitDataFresh(data)) {
    try {
      sessionStorage.removeItem('tg_init_data');
    } catch (_) {}
    // Живой WebApp.initData важнее кэша — если и он протух, шлём пусто → баннер.
    const live = String(getTg()?.initData || '').trim();
    return live && isInitDataFresh(live) ? live : '';
  }
  try {
    sessionStorage.setItem('tg_init_data', data);
  } catch (_) {}
  return data;
}

console.log("Telegram WebApp available:", Boolean(getTg()));
console.log("Telegram initData exists:", Boolean(resolveTelegramInitData()));
console.log("Telegram platform:", getTg()?.platform || '-');
console.log("Telegram user:", getTelegramUser());
console.log("Will send Telegram initData to backend:", Boolean(resolveTelegramInitData()));

// Относительный путь: фронт и API на одном домене через Nginx.
// Работает и локально (если открывать через тот же origin), и на проде (https://loverussian.duckdns.org/api).
const API_BASE = "/api";

function ensureAuthBanner() {
  const hasAuth = Boolean(resolveTelegramInitData());
  let el = document.getElementById('tg-auth-banner');
  if (hasAuth) {
    if (el) el.remove();
    return;
  }
  if (el) return;
  el = document.createElement('div');
  el.id = 'tg-auth-banner';
  el.setAttribute(
    'style',
    'position:sticky;top:0;z-index:9999;padding:10px 14px;background:#5c1a1a;color:#ffe8e8;font:500 13px/1.35 Syne,system-ui,sans-serif;text-align:center',
  );
  el.textContent =
    'Нет Telegram-авторизации — показан тестовый пустой профиль. Закрой Mini App и открой снова из бота (лучше с телефона).';
  document.body.prepend(el);
}

/**
 * Универсальный запрос к backend.
 * Объекты в options.body автоматически преобразуются в JSON.
 */
async function request(path, options = {}) {
  const telegramInitData = cacheInitDataIfAny();

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

  getAdminConsole: () => request('/admin/console'),
  getAdminBlacklist: () => request('/admin/console/blacklist'),
  addAdminBlacklist: (input) =>
    request('/admin/console/blacklist', {
      method: 'POST',
      body: { input },
    }),
  deleteAdminBlacklist: (telegramId) =>
    request(`/admin/console/blacklist/${encodeURIComponent(telegramId)}`, {
      method: 'DELETE',
    }),
  adminStartAi: (id) =>
    request(`/admin/console/accounts/${id}/start-ai`, { method: 'POST' }),
  adminStopAi: (id) =>
    request(`/admin/console/accounts/${id}/stop-ai`, { method: 'POST' }),
  adminPing: (id) => request(`/admin/console/accounts/${id}/ping`),
  adminDeleteAccount: (id) =>
    request(`/admin/console/accounts/${id}`, { method: 'DELETE' }),
  adminBulkAiOn: () =>
    request('/admin/console/accounts/bulk/start-ai', {
      method: 'POST',
      body: {},
    }),
  adminBulkAiOff: () =>
    request('/admin/console/accounts/bulk/stop-ai', {
      method: 'POST',
      body: {},
    }),
  adminCreateAccount: (body) =>
    request('/admin/console/accounts', { method: 'POST', body }),
  adminConnectStart: (body) =>
    request('/admin/console/accounts/connect/start', { method: 'POST', body }),
  adminConnectResend: (body) =>
    request('/admin/console/accounts/connect/resend', { method: 'POST', body }),
  adminConnectCode: (body) =>
    request('/admin/console/accounts/connect/code', { method: 'POST', body }),
  adminConnectPassword: (body) =>
    request('/admin/console/accounts/connect/password', {
      method: 'POST',
      body,
    }),
  getAdminProxies: () => request('/admin/console/proxies'),
  getAdminPersonaPreview: (id) =>
    request(`/admin/console/accounts/${id}/persona-preview`),
  adminFlagBadReply: (body) =>
    request('/admin/console/learn/bad-reply', { method: 'POST', body }),
  adminExpireNftStale: () =>
    request('/admin/console/nft/expire-stale', { method: 'POST' }),
  checkAdminProxies: (pool = 'all') =>
    request('/admin/console/proxies/check', {
      method: 'POST',
      body: { pool },
    }),
  getAdminLogs: (opts = {}) => {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.afterId) params.set('afterId', String(opts.afterId));
    const qs = params.toString();
    return request(`/admin/console/logs${qs ? `?${qs}` : ''}`);
  },
  clearAdminLogs: () => request('/admin/console/logs', { method: 'DELETE' }),
  getAdminActivity: (opts = {}) => {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.afterId) params.set('afterId', String(opts.afterId));
    const qs = params.toString();
    return request(`/admin/console/activity${qs ? `?${qs}` : ''}`);
  },
  getWorkerActivity: (opts = {}) => {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.afterId) params.set('afterId', String(opts.afterId));
    const qs = params.toString();
    return request(`/accounts/activity${qs ? `?${qs}` : ''}`);
  },

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

  connectQrStart: (prompt) =>
    request('/accounts/connect/qr/start', {
      method: 'POST',
      body: { prompt: prompt || '' },
    }),

  connectQrPoll: (prompt) =>
    request('/accounts/connect/qr/poll', {
      method: 'POST',
      body: { prompt: prompt || '' },
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

  personaTemplates: () => request('/accounts/persona-templates'),
  workerTasks: () => request('/accounts/worker-tasks'),
  doneWorkerTask: (id) =>
    request(`/accounts/worker-tasks/${id}/done`, {
      method: 'POST',
    }),

  startAi: (id) =>
    request(`/accounts/${id}/start-ai`, {
      method: 'POST',
    }),

  stopAi: (id) =>
    request(`/accounts/${id}/stop-ai`, {
      method: 'POST',
    }),

  bulkStartAi: (ids) =>
    request('/accounts/bulk/start-ai', {
      method: 'POST',
      body: ids?.length ? { ids } : {},
    }),

  bulkStopAi: (ids) =>
    request('/accounts/bulk/stop-ai', {
      method: 'POST',
      body: ids?.length ? { ids } : {},
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

  deleteExample: (id) =>
    request(`/examples/${id}`, {
      method: 'DELETE',
    }),

  flagBadReply: (accountId, peerId, body = {}) =>
    request(`/accounts/conversations/${accountId}/${peerId}/bad-reply`, {
      method: 'POST',
      body,
    }),
  getConversations: (opts = {}) => {
    const params = new URLSearchParams();
    if (opts.sort) params.set('sort', opts.sort);
    if (opts.hotOnly) params.set('hotOnly', '1');
    if (opts.stage) params.set('stage', opts.stage);
    const qs = params.toString();
    return request(`/accounts/conversations${qs ? `?${qs}` : ''}`);
  },

  pauseConversationBot: (accountId, peerId, paused) =>
    request(`/accounts/conversations/${accountId}/${peerId}/pause-bot`, {
      method: 'POST',
      body: { paused: Boolean(paused) },
    }),

  focusConversation: (accountId, peerId, focus) =>
    request(`/accounts/conversations/${accountId}/${peerId}/focus`, {
      method: 'POST',
      body: { focus: Boolean(focus) },
    }),

  setFunnelStage: (accountId, peerId, stage) =>
    request(`/accounts/conversations/${accountId}/${peerId}/funnel`, {
      method: 'POST',
      body: { stage },
    }),

  clearConversation: (accountId, peerId) =>
    request(`/accounts/conversations/${accountId}/${peerId}`, {
      method: 'DELETE',
    }),

  exportConversation: (accountId, peerId) =>
    request(`/accounts/conversations/${accountId}/${peerId}/export`),

  conversationToExamples: (accountId, peerId, opts = {}) =>
    request(`/accounts/conversations/${accountId}/${peerId}/to-examples`, {
      method: 'POST',
      body: {
        limit: opts.limit ?? 8,
        toRag: opts.toRag !== false,
      },
    }),

  getStats: () => request('/stats'),
};

/**
 * Начальное состояние не содержит тестовых данных.
 * После загрузки страницы значения заменяются данными backend.
 */
function loadStoredSelection() {
  try {
    const raw = localStorage.getItem('selectedAccountIds');
    const ids = raw ? JSON.parse(raw) : [];
    return new Set((Array.isArray(ids) ? ids : []).map(String));
  } catch (_) {
    return new Set();
  }
}

function persistSelection() {
  try {
    localStorage.setItem(
      'selectedAccountIds',
      JSON.stringify([...state.selectedAccountIds]),
    );
  } catch (_) {}
}

function loadStoredNotifications() {
  try {
    const raw = sessionStorage.getItem('notifCenter');
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.slice(0, 40) : [];
  } catch (_) {
    return [];
  }
}

function persistNotifications() {
  try {
    sessionStorage.setItem(
      'notifCenter',
      JSON.stringify(state.notifications.slice(0, 40)),
    );
  } catch (_) {}
}

const state = {
  activeTab: localStorage.getItem('currentTab') || 'panel',

  dashboard: {
    balance: 0,
    subscription: false,
    accountsUsed: 0,
    accountsLimit: 10,
    messages: 0,
    isBetaTester: false,
    isAdmin: false,
  },

  admin: {
    sub: 'accounts',
    console: null,
    blacklist: [],
    activity: [],
    activityKind: 'all',
    proxies: null,
    connect: null,
    logsAfterId: 0,
    logsTimer: null,
    activityTimer: null,
    loaded: false,
  },

  workerActivity: {
    items: [],
    kind: 'all',
    timer: null,
  },

  accounts: [],
  selectedAccountIds: loadStoredSelection(),
  examples: [],
  conversations: [],
  conversationsSort: 'funnel',
  conversationsHotOnly: false,
  conversationsStage: '',
  funnelCounts: {},
  funnelLabels: {
    day1: '1 день',
    day2: '2 день',
    day3: '3 день · NFT',
    day4: '4 день · NFT',
    filtered: 'Отсев',
  },
  funnelStages: ['day1', 'day2', 'day3', 'day4'],

  options: {
    delay: 15,
    min: 15,
    max: 25,
  },

  blacklist: [],
  photoExceptions: [],

  stats: {
    messages: 0,
    referrals: 0,
    income: 0,
    accounts: 0,
  },

  notifications: loadStoredNotifications(),
  notifOpen: false,
  notifUnread: 0,
  silentRefresh: false,
  backgroundTimer: null,
};

const elements = {
  pageTitle: document.getElementById('page-title'),
  content: document.querySelector('.content'),
  tabs: Array.from(document.querySelectorAll('.nav-btn, .side-nav__btn')),
  panels: Array.from(document.querySelectorAll('.tab-panel')),
  panelSummary: document.getElementById('panel-summary'),
  panelAccounts: document.getElementById('panel-accounts'),
  accountsList: document.getElementById('accounts-list'),
  accountsBulkBar: document.getElementById('accounts-bulk-bar'),
  accountsSelectedCount: document.getElementById('accounts-selected-count'),
  mediaGalleryPreview: document.getElementById('media-gallery-preview'),
  notifCenter: document.getElementById('notif-center'),
  notifList: document.getElementById('notif-list'),
  notifBadge: document.getElementById('notif-badge'),
  accountForm: document.getElementById('account-form'),
  exampleForm: document.getElementById('example-form'),
  learnList: document.getElementById('learn-list'),
  conversationsList: document.getElementById('conversations-list'),
  updatesList: document.getElementById('updates-list'),
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
  blacklistPanel: document.getElementById('blacklist-panel'),
  blacklistCount: document.getElementById('blacklist-count'),
  blacklistList: document.getElementById('blacklist-list'),
  photoExceptionInput: document.getElementById('photo-exception-input'),
  addPhotoException: document.getElementById('add-photo-exception'),
  clearPhotoExceptions: document.getElementById('clear-photo-exceptions'),
  photoExceptionsPanel: document.getElementById('photo-exceptions-panel'),
  photoExceptionsCount: document.getElementById('photo-exceptions-count'),
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

/** Только http(s) t.me / @user / +invite — не javascript: и не чужие схемы. */
function safeTelegramHref(raw) {
  const s = String(raw ?? '').trim();
  if (/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\/[^\s<>"']+$/i.test(s)) {
    return s;
  }
  if (/^@[A-Za-z0-9_]{3,64}$/.test(s)) {
    return `https://t.me/${s.slice(1)}`;
  }
  if (/^\+[A-Za-z0-9_-]{3,128}$/.test(s)) {
    return `https://t.me/${s}`;
  }
  return '';
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

function ensureToastStack() {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

function showToast(message) {
  const stack = ensureToastStack();
  // Один тост на один и тот же текст — обновляем счётчик, не плодим стопку.
  const base = notifBaseText(message);
  const existing = Array.from(stack.querySelectorAll('.toast')).find(
    (el) => notifBaseText(el.textContent || '') === base,
  );
  if (existing) {
    existing.textContent = message;
    existing.dataset.expireAt = String(Date.now() + 2800);
      return;
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.dataset.expireAt = String(Date.now() + 2800);
  stack.prepend(toast);
  const tick = () => {
    if (!toast.isConnected) return;
    if (Date.now() >= Number(toast.dataset.expireAt || 0)) {
      toast.remove();
      return;
    }
    setTimeout(tick, 200);
  };
  setTimeout(tick, 2800);
}

/** «Данные обновлены х2» → база «Данные обновлены». */
function notifBaseText(text) {
  return String(text || '')
    .trim()
    .replace(/\s*х\d+\s*$/i, '')
    .trim();
}

function formatNotifWithCount(base, count) {
  const n = Math.max(1, Number(count) || 1);
  return n > 1 ? `${base} х${n}` : base;
}

function pushNotification(message, { silent = false } = {}) {
  const raw = String(message || '').trim();
  if (!raw) return;
  const base = notifBaseText(raw);
  const top = state.notifications[0];
  const topBase = top ? notifBaseText(top.text) : '';

  if (top && topBase === base) {
    const nextCount = Math.max(2, Number(top.count || 1) + 1);
    top.count = nextCount;
    top.text = formatNotifWithCount(base, nextCount);
    top.at = Date.now();
    persistNotifications();
    renderNotifications();
    if (!silent && !state.silentRefresh) showToast(top.text);
    return;
  }

  state.notifications.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: base,
    count: 1,
    at: Date.now(),
  });
  state.notifications = state.notifications.slice(0, 40);
  if (!state.notifOpen) state.notifUnread += 1;
  persistNotifications();
  renderNotifications();
  if (!silent && !state.silentRefresh) showToast(base);
}

function renderNotifications() {
  if (elements.notifBadge) {
    const n = state.notifUnread;
    elements.notifBadge.hidden = n <= 0;
    elements.notifBadge.textContent = n > 99 ? '99+' : String(n);
  }
  if (!elements.notifList) return;
  if (!state.notifications.length) {
    elements.notifList.innerHTML =
      '<div class="empty-state"><p>Пока пусто</p></div>';
    return;
  }
  elements.notifList.innerHTML = state.notifications
    .map((item) => {
      const time = new Date(item.at).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      });
      return `<div class="notif-item"><span class="notif-item__time">${time}</span>${escapeHtml(item.text)}</div>`;
    })
    .join('');
}

function toggleNotifications(force) {
  state.notifOpen = typeof force === 'boolean' ? force : !state.notifOpen;
  if (elements.notifCenter) {
    elements.notifCenter.hidden = !state.notifOpen;
  }
  if (state.notifOpen) {
    state.notifUnread = 0;
    renderNotifications();
  }
}

function clearNotifications() {
  state.notifications = [];
  state.notifUnread = 0;
  persistNotifications();
  renderNotifications();
}

function notify(message, opts = {}) {
  pushNotification(message, opts);
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
    item.user_telegram_id ??
    item.telegram_user_id ??
    item.blocked_user_id ??
    ''
  );
}

function getExampleAccountId(example) {
  return example.accountId ?? example.account_id ?? null;
}

function getExampleAccountName(example) {
  const accountId = getExampleAccountId(example);
  const account = state.accounts.find(
    (item) => String(item.id) === String(accountId),
  );
  if (account) return formatAccountTitle(account);

  const accountName =
    example.accountPhone ??
    example.account_phone ??
    example.phone ??
    example.account;

  return accountName || 'Аккаунт';
}

/** Юз / имя TG / имя из промпта — что показать вместо голого номера. */
function formatAccountTitle(account) {
  const name = String(account?.name || '').trim();
  const uname = String(account?.username || account?.tg_username || '')
    .trim()
    .replace(/^@+/, '');
  if (name && uname && !/^@/i.test(name) && !name.toLowerCase().includes(uname.toLowerCase())) {
    return `${name} · @${uname}`;
  }
  if (name) return name;
  if (uname) return `@${uname}`;
  return String(account?.phone || `#${account?.id || '?'}`);
}

function formatAccountSub(account) {
  const title = formatAccountTitle(account);
  const phone = String(account?.phone || '').trim();
  if (phone && title !== phone) return phone;
  const uname = String(account?.username || '')
    .trim()
    .replace(/^@+/, '');
  if (uname && !title.includes(`@${uname}`)) return `@${uname}`;
  return '';
}

function syncNavIndicator() {
  const nav = document.querySelector('.bottom-nav');
  if (!nav) return;
  const indicator = nav.querySelector('.nav-indicator');
  const active = Array.from(nav.querySelectorAll('.nav-btn')).find(
    (btn) => btn.classList.contains('active') && !btn.hidden,
  );
  if (!indicator || !active) {
    if (indicator) indicator.classList.add('is-hidden');
    return;
  }
  const nr = nav.getBoundingClientRect();
  const ar = active.getBoundingClientRect();
  nav.style.setProperty('--nav-x', `${Math.max(0, ar.left - nr.left)}px`);
  nav.style.setProperty('--nav-w', `${ar.width}px`);
  nav.style.setProperty('--nav-h', `${ar.height}px`);
  nav.style.setProperty('--nav-top', `${Math.max(0, ar.top - nr.top)}px`);
  indicator.classList.remove('is-hidden');
}

function bumpPageTitle(label) {
  if (!elements.pageTitle) return;
  elements.pageTitle.textContent = label;
  elements.pageTitle.classList.remove('is-swap');
  void elements.pageTitle.offsetWidth;
  elements.pageTitle.classList.add('is-swap');
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  localStorage.setItem('currentTab', tabName);

  const titles = {
    panel: 'Панель',
    accounts: 'Аккаунты TG',
    leads: 'Лиды',
    learn: 'Учить',
    info: 'Обновления',
    options: 'Опции',
    stats: 'Статы',
    admin: 'Админ',
  };

  if (!state.dashboard.isAdmin && tabName === 'admin') {
    tabName = 'panel';
    state.activeTab = 'panel';
  }

  bumpPageTitle(titles[tabName] || 'Панель');

  elements.tabs.forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabName);
  });

  elements.panels.forEach((panel) => {
    const on = panel.dataset.panel === tabName;
    panel.classList.toggle('active', on);
    if (on) {
      panel.classList.remove('is-anim');
      void panel.offsetWidth;
      panel.classList.add('is-anim');
    } else {
      panel.classList.remove('is-anim');
    }
  });

  // Контент скроллится отдельно от shell — при смене вкладки всегда сверху.
  if (elements.content) {
    elements.content.scrollTop = 0;
  }

  syncNavIndicator();
  window.requestAnimationFrame(syncNavIndicator);

  if (tabName === 'admin' && state.dashboard.isAdmin) {
    loadAdminData().catch((err) => handleRequestError(err));
  } else {
    stopAdminLiveTimers();
  }
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
    isBetaTester: Boolean(
      dashboard.isBetaTester ?? dashboard.is_beta_tester,
    ),
    isAdmin: Boolean(dashboard.isAdmin ?? dashboard.is_admin),
  };
  syncAdminVisibility();
}

async function loadAccounts() {
  const response = await api.getAccounts();
  state.accounts = getResponseArray(response, 'accounts');
  const alive = new Set(state.accounts.map((a) => String(a.id)));
  const next = new Set(
    [...state.selectedAccountIds].filter((id) => alive.has(String(id))),
  );
  state.selectedAccountIds = next;
  persistSelection();
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

async function loadPhotoExceptions() {
  const response = await api.getPhotoExceptions();
  state.photoExceptions = getResponseArray(response, 'chats');
}

async function loadExamples() {
  const response = await api.getExamples();
  state.examples = getResponseArray(response, 'examples');
}

async function loadConversations() {
  const response = await api.getConversations({
    sort: state.conversationsSort,
    hotOnly: state.conversationsHotOnly,
    stage: state.conversationsStage || undefined,
  });
  state.conversations = getResponseArray(response, 'conversations');
  state.funnelCounts = response.funnel || {};
  if (Array.isArray(response.stages) && response.stages.length) {
    state.funnelStages = response.stages;
  }
  if (response.labels && typeof response.labels === 'object') {
    state.funnelLabels = { ...state.funnelLabels, ...response.labels };
  }
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
async function loadWorkerTasks() {
  const box = document.getElementById('worker-tasks-list');
  if (!box) return;
  try {
    const data = await api.workerTasks();
    const tasks = data.tasks || [];
    if (!tasks.length) {
      box.innerHTML = `<div class="empty-state"><p>Открытых задач нет</p></div>`;
      return;
    }
    box.innerHTML = tasks
      .map((t) => {
        const acc = t.account_id ? `#${t.account_id}` : '';
        const kind = t.kind ? String(t.kind) : '';
        return `<article class="account-card" data-task-id="${t.id}">
          <div class="account-card__main">
            <div class="account-card__phone">${escapeHtml(t.title || 'Задача')}</div>
            <div class="account-card__meta">
              ${acc ? `<span>анкета ${escapeHtml(acc)}</span>` : ''}
              ${kind ? `<span class="badge badge-soft">${escapeHtml(kind)}</span>` : ''}
            </div>
          </div>
          <div class="account-card__actions">
            <button class="btn btn-secondary small" type="button" data-action="done-task" data-id="${t.id}">Готово</button>
          </div>
        </article>`;
      })
      .join('');
  } catch (e) {
    box.innerHTML = `<div class="empty-state"><p>Не удалось загрузить задачи</p></div>`;
    console.warn('worker tasks:', e.message);
  }
}

async function loadAllData() {
  const results = await Promise.allSettled([
    loadDashboard(),
    loadAccounts(),
    loadOptions(),
    loadBlacklist(),
    loadPhotoExceptions(),
    loadExamples(),
    loadConversations(),
    loadStats(),
    loadWorkerTasks(),
    loadWorkerActivity(),
  ]);

  syncWorkerActivityLive();
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

  const online = state.accounts.filter((a) => a.is_online).length;
  const aiOn = state.accounts.filter((a) => isAiEnabled(a)).length;
  const hotLeads = Number(state.funnelCounts?.day3 || 0) +
    Number(state.funnelCounts?.day4 || 0);

  const liveEl = document.getElementById('panel-live');
  if (liveEl) {
    const parts = [];
    parts.push(state.accounts.length ? `${online} онлайн` : 'нет аккаунтов');
    parts.push(`AI ${aiOn}/${state.accounts.length || 0}`);
    if (hotLeads > 0) parts.push(`${hotLeads} горячих`);
    else parts.push(`${messages} сообщ.`);
    liveEl.textContent = parts.join(' · ');
  }

  elements.panelSummary.innerHTML = `
    <div class="stat-card stat-card--accent">
      <strong class="stat-card__value">${accountsUsed}/${accountsLimit}</strong>
      <span class="stat-card__label">Аккаунты</span>
    </div>
    <div class="stat-card">
      <strong class="stat-card__value">${online}/${aiOn}</strong>
      <span class="stat-card__label">Онлайн / AI</span>
    </div>
    <div class="stat-card">
      <strong class="stat-card__value">${messages}</strong>
      <span class="stat-card__label">Сообщения</span>
    </div>
    <div class="stat-card ${hotLeads ? 'stat-card--hot' : ''}">
      <strong class="stat-card__value">${hotLeads || '—'}</strong>
      <span class="stat-card__label">Горячие лиды</span>
    </div>
  `;

  if (!state.accounts.length) {
    elements.panelAccounts.innerHTML = `
      <div class="empty-state card">
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

  elements.panelAccounts.innerHTML = `
    <div class="section-card card panel-accounts-card">
      <div class="stack">
        ${state.accounts
          .slice(0, 6)
    .map((account) => {
      const aiEnabled = isAiEnabled(account);
      const isOnline = !!account.is_online;
      return `
        <div class="account-item">
          <div class="account-item__head">
            <strong>
              <span class="online-dot ${isOnline ? 'is-online' : 'is-offline'}"></span>
              <span class="account-item__title">${escapeHtml(formatAccountTitle(account))}</span>
            </strong>
            <span class="badge ${aiEnabled ? 'success' : 'warn'}">
              ${escapeHtml(account.status || (aiEnabled ? 'AI включен' : 'Остановлен'))}
            </span>
            ${
              formatAccountSub(account)
                ? `<span class="account-item__sub">${escapeHtml(formatAccountSub(account))}</span>`
                : ''
            }
          </div>
          <div class="action-row">
            <button class="btn btn-secondary" data-action="details" data-id="${account.id}" type="button">Карточка</button>
            ${
              aiEnabled
                ? `<button class="btn btn-secondary" data-action="stop" data-id="${account.id}" type="button">Стоп</button>`
                : `<button class="btn btn-primary" data-action="ai" data-id="${account.id}" type="button">AI</button>`
            }
          </div>
        </div>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

function isAccountSelected(id) {
  return state.selectedAccountIds.has(String(id));
}

function setAccountSelected(id, selected) {
  const key = String(id);
  if (selected) state.selectedAccountIds.add(key);
  else state.selectedAccountIds.delete(key);
  persistSelection();
  updateAccountsBulkBar();
}

function updateAccountsBulkBar() {
  const count = state.selectedAccountIds.size;
  if (elements.accountsSelectedCount) {
    elements.accountsSelectedCount.textContent = `Выбрано: ${count}`;
  }
  if (elements.accountsBulkBar) {
    elements.accountsBulkBar.hidden = count === 0;
  }
}

function renderMediaGalleryPreview() {
  if (!elements.mediaGalleryPreview) return;
  const withMedia = state.accounts.filter((a) => a.media_chat_link);
  if (!withMedia.length) {
    elements.mediaGalleryPreview.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <p>Нет привязанных медиа-чатов. Открой карточку аккаунта и укажи ссылку на тгк.</p>
      </div>
    `;
    return;
  }
  elements.mediaGalleryPreview.innerHTML = withMedia
    .slice(0, 6)
    .map(
      (account) => `
        <button class="media-tile" type="button" data-action="details" data-id="${account.id}">
          <span class="media-tile__phone">${escapeHtml(account.phone)}</span>
          <span class="media-tile__link">${escapeHtml(account.media_chat_link)}</span>
            </button>
      `,
    )
    .join('');
}

function openMediaGallery() {
  const withMedia = state.accounts.filter((a) => a.media_chat_link);
  closeAccountModal();
  const overlay = document.createElement('div');
  overlay.id = 'account-modal';
  overlay.className = 'modal-overlay media-gallery-overlay';
  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="Медиагалерея">
      <div class="modal-card__header">
        <div>
          <p class="modal-card__eyebrow">Медиа</p>
          <h3 class="modal-card__title">Галерея источников</h3>
        </div>
        <button class="modal-close" type="button" aria-label="Закрыть" data-modal-close>×</button>
      </div>
      <div class="media-gallery-preview" style="grid-template-columns:1fr;">
        ${
          withMedia.length
            ? withMedia
                .map(
                  (account) => `
                    <div class="media-tile">
                      <span class="media-tile__phone">${escapeHtml(account.phone)}</span>
                      <span class="media-tile__link">${escapeHtml(account.media_chat_link)}</span>
                      <div class="action-row" style="margin-top:6px;">
                        <button class="btn btn-secondary small" type="button" data-action="details" data-id="${account.id}" data-modal-close>Карточка</button>
                        ${
                          safeTelegramHref(account.media_chat_link)
                            ? `<a class="btn btn-primary small" href="${escapeHtml(safeTelegramHref(account.media_chat_link))}" target="_blank" rel="noopener noreferrer">Открыть</a>`
                            : ''
                        }
                      </div>
                    </div>
                  `,
                )
                .join('')
            : '<div class="empty-state"><p>Пока нет медиа-ссылок</p></div>'
        }
          </div>
        </div>
      `;
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  document.addEventListener('keydown', onModalKeydown);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-modal-close]')) {
      const detailsBtn = event.target.closest('[data-action="details"]');
      const id = detailsBtn?.dataset?.id;
      closeAccountModal();
      if (id) handleDetails(id);
    }
  });
}

function renderAccounts() {
  if (!elements.accountsList || !elements.exampleAccount) {
    return;
  }

  const usedAccounts = state.dashboard.accountsUsed;
  const accountsLimit = state.dashboard.accountsLimit;
  const availableAccounts = Math.max(accountsLimit - usedAccounts, 0);

  if (!state.accounts.length) {
    elements.accountsList.innerHTML = `
      <div class="empty-state">
        <h3>Аккаунтов пока нет</h3>
        <p>Добавьте первый Telegram-аккаунт, чтобы начать работу.</p>
      </div>
    `;
  } else {
    const allSelected =
      state.accounts.length > 0 &&
      state.accounts.every((a) => isAccountSelected(a.id));
    elements.accountsList.innerHTML = `
      <div class="accounts-cards">
        <div class="account-card account-card--select-all" role="group" aria-label="Выбрать все">
          <input
            class="account-card__check"
            type="checkbox"
            data-action="select-all-accounts"
            ${allSelected ? 'checked' : ''}
            aria-label="Выбрать все"
          />
          <span class="account-card__phone">Выбрать все</span>
        </div>
        ${state.accounts
        .map((account) => {
          const aiEnabled = isAiEnabled(account);
            const selected = isAccountSelected(account.id);
            const isOnline = !!account.is_online;
            const sentToday = Number(
              account.sent_today ?? account.sentToday ?? 0,
            );
            const title = escapeHtml(formatAccountTitle(account));
            const sub = formatAccountSub(account);
          return `
              <article
                class="account-card ${selected ? 'is-selected' : ''}"
                data-account-row="${account.id}"
              >
                <div class="account-card__top">
                  <input
                    class="account-card__check"
                    type="checkbox"
                    data-action="select-account"
                    data-id="${account.id}"
                    ${selected ? 'checked' : ''}
                    aria-label="Выбрать ${title}"
                  />
                  <div class="account-card__main">
                    <div class="account-card__phone">
                      <span class="online-dot ${isOnline ? 'is-online' : 'is-offline'}"></span>
                      ${title}
                    </div>
                    ${
                      sub
                        ? `<div class="account-card__sub">${escapeHtml(sub)}</div>`
                        : ''
                    }
                    <div class="account-card__meta">
                      <span class="badge ${aiEnabled ? 'success' : 'warn'}">
                        AI ${aiEnabled ? 'вкл' : 'выкл'}
                      </span>
                      <span>${isOnline ? 'онлайн' : 'офлайн'}</span>
                      <span title="Сообщений с 00:00 МСК">сегодня · <strong>${sentToday}</strong></span>
                      <span>медиа · ${account.media_chat_link ? 'есть' : 'нет'}</span>
                      ${
                        account.health_missing && account.health_missing.length
                          ? `<span class="badge warn" title="Не хватает для спокойной работы">нужно: ${escapeHtml(
                              account.health_missing.join(', '),
                            )}</span>`
                          : `<span class="badge success">готово</span>`
                      }
                    </div>
                  </div>
                </div>
                <div class="account-card__actions">
                ${
                  aiEnabled
                      ? `<button class="btn btn-secondary small" data-action="stop" data-id="${account.id}" type="button">Стоп</button>`
                      : `<button class="btn btn-primary small" data-action="ai" data-id="${account.id}" type="button">AI</button>`
                  }
                  <button class="btn btn-secondary small" data-action="details" data-id="${account.id}" type="button">Карточка</button>
                  <button class="btn btn-danger small" data-action="delete" data-id="${account.id}" type="button">Удал.</button>
              </div>
              </article>
            `;
          })
          .join('')}
      </div>
    `;
  }

  updateAccountsBulkBar();
  renderMediaGalleryPreview();

  elements.exampleAccount.innerHTML = state.accounts.length
    ? state.accounts
        .map(
          (account) => `
            <option value="${account.id}">
              ${escapeHtml(formatAccountTitle(account))}${
                formatAccountSub(account) ? ` · ${escapeHtml(formatAccountSub(account))}` : ''
              }
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

function leadTierBadge(tier, score) {
  const label =
    tier === 'hot' ? `🔥 ${score}` : tier === 'warm' ? `⚡ ${score}` : `${score}`;
  const cls =
    tier === 'hot' ? 'badge badge-hot' : tier === 'warm' ? 'badge warn' : 'badge badge-soft';
  return `<span class="${cls}" title="Приоритет лида">${escapeHtml(label)}</span>`;
}

function funnelStageBadge(stage, label, isAuto) {
  const text = label || stage || '';
  return `<span class="badge badge-funnel badge-funnel--${escapeHtml(String(stage || 'chat'))}" title="${isAuto ? 'авто' : 'вручную'}">${escapeHtml(text)}${isAuto ? '' : ' ✎'}</span>`;
}

function formatPeerLabel(username, peerId) {
  const raw = String(username || '').trim();
  if (raw && !/^\d+$/.test(raw)) {
    return raw.startsWith('@') ? raw : `@${raw}`;
  }
  const id = String(peerId || raw || '').trim();
  if (!id) return 'Собеседник';
  return id.length > 12 ? `id·${id.slice(0, 4)}…${id.slice(-4)}` : `id·${id}`;
}

function renderConversations() {
  if (!elements.conversationsList) {
    return;
  }

  const sortMode = state.conversationsSort;
  const hotOnly = state.conversationsHotOnly;
  const stageFilter = state.conversationsStage || '';
  const counts = state.funnelCounts || {};
  const labels = state.funnelLabels || {};
  const stages =
    Array.isArray(state.funnelStages) && state.funnelStages.length
      ? state.funnelStages
      : ['day1', 'day2', 'day3', 'day4'];

  const onboardKey = 'lr-funnel-onboard-v1';
  let showOnboard = false;
  try {
    showOnboard = localStorage.getItem(onboardKey) !== '1';
  } catch (_) {
    showOnboard = true;
  }
  const onboardBanner = showOnboard
    ? `<div class="funnel-onboard" data-action="dismiss-onboard">
        <strong>Воронка по дням</strong>
        <p>1 день — знакомство · 2 день — общение · 3–4 день — NFT-кампания (голос и хендофф). Нажми, чтобы скрыть.</p>
      </div>`
    : '';

  const funnelBar = `
    ${onboardBanner}
    <div class="funnel-bar">
      <button class="btn btn-secondary small chip-btn ${!stageFilter ? 'is-active' : ''}" type="button" data-action="funnel-filter" data-stage="">Все</button>
      ${stages
        .map((s) => {
          const n = counts[s] || 0;
          const lab = labels[s] || s;
          return `<button class="btn btn-secondary small chip-btn ${stageFilter === s ? 'is-active' : ''}" type="button" data-action="funnel-filter" data-stage="${s}">${escapeHtml(lab)} ${n}</button>`;
        })
        .join('')}
    </div>
  `;

  const toolbar = `
    ${funnelBar}
    <div class="conversations-toolbar">
      <button class="btn btn-secondary small chip-btn ${sortMode === 'funnel' ? 'is-active' : ''}" type="button" data-action="conv-sort-funnel">По воронке</button>
      <button class="btn btn-secondary small chip-btn ${sortMode === 'score' ? 'is-active' : ''}" type="button" data-action="conv-sort-score">По приоритету</button>
      <button class="btn btn-secondary small chip-btn ${sortMode === 'recent' ? 'is-active' : ''}" type="button" data-action="conv-sort-recent">По дате</button>
      <button class="btn btn-secondary small chip-btn ${hotOnly ? 'is-active' : ''}" type="button" data-action="conv-hot-only">${hotOnly ? 'Все диалоги' : 'Только горячие'}</button>
    </div>
  `;

  if (!state.conversations.length) {
    elements.conversationsList.innerHTML = `
      ${toolbar}
      <div class="empty-state">
        <h3>${stageFilter ? 'На этом этапе пусто' : hotOnly ? 'Горячих лидов нет' : 'Диалогов пока нет'}</h3>
        <p>${stageFilter || hotOnly ? 'Сними фильтр или дождись активных диалогов.' : 'Здесь появятся переписки, как только AI начнёт отвечать людям.'}</p>
      </div>
    `;
    return;
  }

  elements.conversationsList.innerHTML =
    toolbar +
    state.conversations
      .map((item) => {
        const accountId = item.accountId ?? item.account_id ?? '';
        const peerId = item.peerId ?? item.peer_id ?? '';
        const peerName = formatPeerLabel(
          item.peerUsername ?? item.peer_username,
          peerId,
        );
        const messageCount =
          item.messageCount ?? item.message_count ?? 0;
        const userMsgs = item.userMsgs ?? item.user_msgs ?? null;
        const botMsgs = item.botMsgs ?? item.bot_msgs ?? null;
        const accountPhone =
          item.accountPhone ?? item.account_phone ?? '';
        const workAcc = state.accounts.find(
          (a) => String(a.id) === String(accountId),
        );
        const apiAccName = String(
          item.accountName ?? item.account_name ?? '',
        ).trim();
        const apiAccUser = String(
          item.accountUsername ?? item.account_username ?? '',
        )
          .trim()
          .replace(/^@+/, '');
        let accountTitle = workAcc
          ? formatAccountTitle(workAcc)
          : formatAccountTitle({
              name: apiAccName,
              username: apiAccUser,
              phone: accountPhone,
              id: accountId,
            });
        if (
          !accountTitle ||
          accountTitle === accountPhone ||
          accountTitle === `#${accountId}`
        ) {
          accountTitle = '';
        }
        const score = item.leadScore ?? item.lead_score ?? 0;
        const tier = item.leadTier ?? item.lead_tier ?? 'cold';
        const paused = Boolean(item.autoreplyDisabled ?? item.autoreply_disabled);
        const focused = Boolean(item.operatorFocus ?? item.operator_focus);
        const funnelStage = item.funnelStage ?? item.funnel_stage ?? 'day1';
        const funnelLabel =
          item.funnelLabel ?? item.funnel_label ?? labels[funnelStage] ?? funnelStage;
        const funnelAuto = item.funnelAuto ?? item.funnel_auto ?? true;
        const operatorNote = String(item.operatorNote ?? item.operator_note ?? '').trim();
        const lastUserAt = item.lastUserAt ?? item.last_user_at ?? item.lastAt ?? item.last_at;
        const lastLabel = lastUserAt
          ? new Date(lastUserAt).toLocaleString('ru-RU', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '';
        const msgBadge =
          userMsgs != null && botMsgs != null
            ? `он ${userMsgs} · она ${botMsgs}`
            : `${messageCount} сообщ.`;

        const stageOptions = [
          ['auto', 'Авто'],
          ...stages.map((s) => [s, labels[s] || s]),
        ]
          .map(
            ([val, lab]) =>
              `<option value="${escapeHtml(val)}" ${(!funnelAuto && funnelStage === val) || (funnelAuto && val === 'auto') ? 'selected' : ''}>${escapeHtml(lab)}</option>`,
          )
          .join('');

        return `
        <div class="lesson-item ${focused ? 'lesson-item--focus' : ''} ${tier === 'hot' ? 'lesson-item--hot' : ''} ${funnelStage === 'filtered' ? 'lesson-item--filtered' : ''} lesson-item--${escapeHtml(String(funnelStage))}">
          <div class="lesson-item__head">
            <strong class="lesson-item__title">${escapeHtml(peerName)}</strong>
            <span class="badge-row">
              ${funnelStageBadge(funnelStage, funnelLabel, funnelAuto)}
              ${leadTierBadge(tier, score)}
              ${paused ? '<span class="badge warn">ИИ на паузе</span>' : ''}
              ${focused ? '<span class="badge success">В фокусе</span>' : ''}
              <span class="badge badge-soft">${escapeHtml(msgBadge)}</span>
            </span>
          </div>

          ${
            accountTitle
              ? `<p class="lesson-item__meta lesson-item__acc-name">${escapeHtml(accountTitle)}</p>`
              : ''
          }
          <p class="lesson-item__meta"><strong>Аккаунт:</strong> ${escapeHtml(accountPhone)}${lastLabel ? ` · писал ${escapeHtml(lastLabel)}` : ''}</p>
          ${
            operatorNote
              ? `<p class="lesson-item__note">${escapeHtml(operatorNote)}</p>`
              : ''
          }

          <div class="lead-actions">
            <label class="funnel-select-wrap lead-actions__stage">
              <span class="visually-hidden">Этап</span>
              <select
                class="funnel-select"
                data-action="funnel-stage"
                data-account="${escapeHtml(String(accountId))}"
                data-peer="${escapeHtml(String(peerId))}"
              >${stageOptions}</select>
            </label>
            <button
              class="btn btn-secondary small"
              data-action="pause-bot"
              data-account="${escapeHtml(String(accountId))}"
              data-peer="${escapeHtml(String(peerId))}"
              data-paused="${paused ? '0' : '1'}"
              type="button"
            >
              ${paused ? 'Вернуть ИИ' : 'Пауза ИИ'}
            </button>
            <button
              class="btn btn-secondary small"
              data-action="focus-lead"
              data-account="${escapeHtml(String(accountId))}"
              data-peer="${escapeHtml(String(peerId))}"
              data-focus="${focused ? '0' : '1'}"
              type="button"
            >
              ${focused ? 'Снять фокус' : 'В фокус'}
            </button>
            <button
              class="btn btn-secondary small"
              data-action="export-chat"
              data-account="${escapeHtml(String(accountId))}"
              data-peer="${escapeHtml(String(peerId))}"
              type="button"
            >
              Экспорт
            </button>
            <button
              class="btn btn-secondary small"
              data-action="to-examples"
              data-account="${escapeHtml(String(accountId))}"
              data-peer="${escapeHtml(String(peerId))}"
              type="button"
            >
              В примеры
            </button>
            <div class="bad-reply-wrap">
              <button
                class="btn btn-secondary small"
                data-action="bad-reply-toggle"
                type="button"
              >
                Плохой ответ
              </button>
              <div class="bad-reply-reasons" hidden>
                <button class="chip-btn" type="button" data-action="bad-reply" data-reason="echo" data-account="${escapeHtml(String(accountId))}" data-peer="${escapeHtml(String(peerId))}">Эхо</button>
                <button class="chip-btn" type="button" data-action="bad-reply" data-reason="offtopic" data-account="${escapeHtml(String(accountId))}" data-peer="${escapeHtml(String(peerId))}">Мимо</button>
                <button class="chip-btn" type="button" data-action="bad-reply" data-reason="robot" data-account="${escapeHtml(String(accountId))}" data-peer="${escapeHtml(String(peerId))}">Робот</button>
                <button class="chip-btn" type="button" data-action="bad-reply" data-reason="other" data-account="${escapeHtml(String(accountId))}" data-peer="${escapeHtml(String(peerId))}">Другое</button>
              </div>
            </div>
            <button
              class="btn btn-danger small"
              data-action="clear-history"
              data-account="${escapeHtml(String(accountId))}"
              data-peer="${escapeHtml(String(peerId))}"
              type="button"
            >
              Стереть
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

      const exampleId = item.id ?? item.example_id ?? '';

      return `
        <div class="lesson-item">
          <div class="lesson-item__head">
            <strong class="lesson-item__title">${escapeHtml(getExampleAccountName(item))}</strong>
            <span class="badge-row">
            <span class="badge badge-soft">Пример</span>
              ${
                exampleId
                  ? `<button class="btn btn-danger small" type="button" data-action="delete-example" data-id="${escapeHtml(String(exampleId))}">Удал.</button>`
                  : ''
              }
            </span>
          </div>

          <p>
            <strong>Человек:</strong>
            ${escapeHtml(clientMessage)}
          </p>

          <p>
            <strong>Ответ:</strong>
            ${escapeHtml(correctAnswer)}
          </p>

          ${
            item.note
              ? `<p><strong>Заметка:</strong> ${escapeHtml(item.note)}</p>`
              : ''
          }
        </div>
      `;
    })
    .join('');
}

function renderDelayPreview() {
  if (!elements.optionsPreview) {
    return;
  }

  elements.optionsPreview.innerHTML = `
    <div class="option-item">
      <strong>Задержка</strong>
      <p>${state.options.delay} сек</p>
    </div>
    <div class="option-item">
      <strong>Диапазон</strong>
      <p>${state.options.min}–${state.options.max} сек</p>
    </div>
  `;
}

function renderBlacklist() {
  renderDelayPreview();

  const count = state.blacklist.length;
  if (elements.blacklistCount) {
    elements.blacklistCount.textContent = String(count);
  }

  const container = elements.blacklistList;
  if (!container) {
    return;
  }

  if (!count) {
    container.innerHTML =
      '<p class="muted">Список пуст — AI отвечает всем.</p>';
    return;
  }

  container.innerHTML = state.blacklist
        .map((item) => {
          const userId = getBlacklistUserId(item);
          const itemId =
        typeof item === 'object' && item !== null ? item.id : null;

          return `
        <div class="exception-row">
          <div class="exception-row__main">
            <span class="exception-row__handle">${escapeHtml(userId || '—')}</span>
            <span class="exception-row__meta">AI не отвечает</span>
          </div>
              ${
                itemId !== null && itemId !== undefined
                  ? `
                    <button
                  class="exception-row__remove"
                      type="button"
                      data-action="delete-blacklist"
                      data-id="${itemId}"
                  aria-label="Убрать ${escapeHtml(String(userId || ''))} из blacklist"
                  title="Убрать из списка"
                    >
                  <span class="exception-row__remove-icon" aria-hidden="true"></span>
                  Убрать
                    </button>
                  `
                  : ''
              }
        </div>
      `;
    })
    .join('');
}

function openBlacklistPanel() {
  if (elements.blacklistPanel) {
    elements.blacklistPanel.open = true;
  }
}

function openPhotoExceptionsPanel() {
  if (elements.photoExceptionsPanel) {
    elements.photoExceptionsPanel.open = true;
  }
}

function renderPhotoExceptions() {
  const count = state.photoExceptions.length;
  if (elements.photoExceptionsCount) {
    elements.photoExceptionsCount.textContent = String(count);
  }

  const container = elements.photoExceptionsList;
  if (!container) {
    return;
  }

  if (!count) {
    container.innerHTML =
      '<p class="muted">Список пуст — распознавание фото работает для всех.</p>';
    return;
  }

  container.innerHTML = state.photoExceptions
    .map((item) => {
      const identifier = item?.chat_identifier ?? item?.chatIdentifier ?? '';
      const itemId = item?.id;
      const label = String(identifier || '').startsWith('@')
        ? identifier
        : `@${identifier}`;

      return `
        <div class="exception-row">
          <div class="exception-row__main">
            <span class="exception-row__handle">${escapeHtml(label)}</span>
            <span class="exception-row__meta">фото не распознаются</span>
          </div>
          ${
            itemId !== null && itemId !== undefined
              ? `
                <button
                  class="exception-row__remove"
                  type="button"
                  data-action="delete-photo-exception"
                  data-id="${itemId}"
                  aria-label="Убрать ${escapeHtml(label)} из списка"
                  title="Убрать из списка"
                >
                  <span class="exception-row__remove-icon" aria-hidden="true"></span>
                  Убрать
                </button>
              `
              : ''
          }
        </div>
      `;
    })
    .join('');
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
  renderPhotoExceptions();
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
                <strong>${escapeHtml(formatAccountTitle(account))}</strong>
                <span class="badge badge-soft">
                  ${escapeHtml(account.status || (aiEnabled ? 'AI включен' : 'Остановлен'))}
                </span>
              </div>
              ${
                formatAccountSub(account)
                  ? `<div class="account-item__sub">${escapeHtml(formatAccountSub(account))}</div>`
                  : ''
              }
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

function renderUpdates() {
  if (!elements.updatesList) return;
  const entries = Array.isArray(window.LOVERUSSIAN_UPDATES)
    ? window.LOVERUSSIAN_UPDATES
    : [];
  if (!entries.length) {
    elements.updatesList.innerHTML =
      '<div class="empty-state"><p>Обновлений пока нет.</p></div>';
      return;
    }
  elements.updatesList.innerHTML = entries
    .map((entry) => {
      const date = escapeHtml(entry.date || '');
      const tag = entry.tag ? escapeHtml(String(entry.tag)) : '';
      const title = escapeHtml(entry.title || '');
      const lead = escapeHtml(entry.lead || '');
      const items = Array.isArray(entry.items) ? entry.items : [];
      const list = items
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('');
      const isSmall = String(entry.tag || '').toUpperCase().includes('МАЛЕН');
      return `
        <article class="update-block${isSmall ? ' update-block--small' : ''}">
          <p class="update-block__date">${date}${
            tag ? ` <span class="update-block__date-tag">· ${tag}</span>` : ''
          }</p>
          <h2 class="update-block__title">${title}</h2>
          ${lead ? `<p class="update-block__lead">${lead}</p>` : ''}
          ${list ? `<ul class="update-block__list">${list}</ul>` : ''}
        </article>
      `;
    })
    .join('');
}

function syncAdminVisibility() {
  const on = Boolean(state.dashboard?.isAdmin);
  document.querySelectorAll('.admin-only').forEach((el) => {
    el.hidden = !on;
  });
  if (!on && state.activeTab === 'admin') {
    state.activeTab = 'panel';
    localStorage.setItem('currentTab', 'panel');
  }
  window.requestAnimationFrame(syncNavIndicator);
}

const ADMIN_SUBS = new Set(['accounts', 'blacklist', 'add', 'proxies', 'logs', 'activity']);

function stopAdminLiveTimers() {
  if (state.admin.logsTimer) {
    clearInterval(state.admin.logsTimer);
    state.admin.logsTimer = null;
  }
  if (state.admin.activityTimer) {
    clearInterval(state.admin.activityTimer);
    state.admin.activityTimer = null;
  }
}

function syncAdminSubUi(sub) {
  const next = ADMIN_SUBS.has(sub) ? sub : 'accounts';
  document.querySelectorAll('[data-action="admin-sub"]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.sub === next);
  });
  document.querySelectorAll('[data-admin-panel]').forEach((panel) => {
    const on = panel.dataset.adminPanel === next;
    panel.hidden = !on;
    panel.classList.remove('is-anim');
    if (on) {
      void panel.offsetWidth;
      panel.classList.add('is-anim');
    }
  });
  return next;
}

function setAdminSub(sub) {
  const prev = state.admin.sub;
  const next = syncAdminSubUi(sub);
  const same = prev === next;
  state.admin.sub = next;
  if (same && next === 'logs' && state.admin.logsTimer) return;
  if (same && next === 'activity' && state.admin.activityTimer) return;
  if (same && next === 'proxies' && state.admin.proxies) return;
  if (same && next !== 'logs' && next !== 'activity' && next !== 'proxies') return;

  stopAdminLiveTimers();
  if (next === 'logs') {
    loadAdminLogs(true).catch(() => {});
    state.admin.logsTimer = setInterval(() => {
      const live = document.getElementById('admin-logs-live');
      if (live?.checked && state.activeTab === 'admin' && state.admin.sub === 'logs') {
        loadAdminLogs(false).catch(() => {});
      }
    }, 4000);
  }
  if (next === 'proxies') {
    loadAdminProxies().catch((err) => handleRequestError(err));
  }
  if (next === 'activity') {
    loadAdminActivity().catch(() => {});
    state.admin.activityTimer = setInterval(() => {
      const live = document.getElementById('admin-activity-live');
      if (live?.checked && state.activeTab === 'admin' && state.admin.sub === 'activity') {
        loadAdminActivity().catch(() => {});
      }
    }, 5000);
  }
}

async function loadAdminData({ force = false } = {}) {
  if (!state.dashboard.isAdmin) return;
  if (state.admin.loaded && !force && state.admin.console) {
    renderAdmin();
    if (state.activeTab === 'admin') setAdminSub(state.admin.sub);
    return;
  }
  const live = document.getElementById('admin-live');
  if (live) live.textContent = 'Загрузка…';
  const [consoleRes, blRes, actRes] = await Promise.all([
    api.getAdminConsole(),
    api.getAdminBlacklist().catch(() => ({ blacklist: [] })),
    api.getAdminActivity({ limit: 80 }).catch(() => ({ events: [] })),
  ]);
  state.admin.console = consoleRes.console || consoleRes;
  state.admin.blacklist = blRes.blacklist || [];
  state.admin.activity = actRes.events || actRes.items || actRes.activity || [];
  state.admin.loaded = true;
  renderAdmin();
  if (state.activeTab === 'admin') setAdminSub(state.admin.sub);
}

function adminAddPayload() {
  return {
    phone: String(document.getElementById('admin-add-phone')?.value || '').trim(),
    ownerTelegramId: String(document.getElementById('admin-add-owner')?.value || '').trim(),
    prompt: String(document.getElementById('admin-add-prompt')?.value || '').trim(),
  };
}

function setAdminAddStatus(msg) {
  const el = document.getElementById('admin-add-status');
  if (el) el.textContent = msg || '';
}

async function loadAdminProxies() {
  const data = await api.getAdminProxies();
  state.admin.proxies = data.proxies || { work: [], login: [] };
  renderAdminProxies(null);
}

function renderAdminProxyHealthStrip(proxies) {
  const strip = document.getElementById('admin-proxy-health');
  if (!strip) return;
  const s = proxies?.summary || {};
  const workAlive = Number(s.work_alive ?? proxies?.work?.filter((p) => !p.dead).length ?? 0);
  const workTotal = Number(s.work ?? proxies?.work?.length ?? 0);
  const loginAlive = Number(s.login_alive ?? proxies?.login?.filter((p) => !p.dead).length ?? 0);
  const loginTotal = Number(s.login ?? proxies?.login?.length ?? 0);
  const openaiOk = Boolean(s.openai_ready);
  const openaiLen = Number(s.openai_proxy_len || 0);
  const ok = Boolean(s.ok);
  strip.className = `admin-proxy-health ${ok ? 'is-ok' : 'is-bad'}`;
  strip.innerHTML = `
    <div class="admin-proxy-health__item"><span>TG живые</span><strong>${workAlive}/${workTotal}</strong></div>
    <div class="admin-proxy-health__item"><span>Вход</span><strong>${loginAlive}/${loginTotal}</strong></div>
    <div class="admin-proxy-health__item"><span>ИИ</span><strong>${openaiOk ? 'ок' : 'нет'}${openaiLen ? ` · ${openaiLen}` : ''}</strong></div>
  `;
}

function renderAdminProxies(checkMap) {
  const root = document.getElementById('admin-proxy-results');
  const hint = document.getElementById('admin-proxy-hint');
  const proxies = state.admin.proxies || { work: [], login: [] };
  renderAdminProxyHealthStrip(proxies);
  if (hint && !checkMap) {
    const s = proxies.summary || {};
    const wa = s.work_alive != null ? s.work_alive : proxies.work?.filter((p) => !p.dead).length;
    hint.textContent = `Рабочие ${wa ?? 0}/${proxies.work?.length || 0} живые · Резидентские ${proxies.login?.length || 0}`;
  }
  if (!root) return;
  const sections = [
    {
      kind: 'work',
      list: proxies.work || [],
      title: 'Рабочие',
      desc: 'Через них ИИ общается в Telegram',
    },
    {
      kind: 'login',
      list: proxies.login || [],
      title: 'Резидентские',
      desc: 'Через них вход по коду и QR',
    },
  ];
  root.innerHTML = sections
    .map((sec) => {
      const alive = sec.list.filter((p) => !p.dead).length;
      const head = `<h3 class="admin-proxy-title">${escapeHtml(sec.title)} · ${alive}/${sec.list.length}</h3><p class="options-hint">${escapeHtml(sec.desc)}</p>`;
      if (!sec.list.length) {
        return `<div class="admin-proxy-block">${head}<p class="empty">пусто</p></div>`;
      }
      const rows = sec.list
        .map((p) => {
          const key = `${sec.kind}:${p.index}`;
          const chk = checkMap?.[key];
          let badge = '';
          if (chk) {
            if (chk.skipped) badge = '<span class="badge badge-soft">skip</span>';
            else if (chk.ok) badge = `<span class="badge success">ok ${chk.ms}ms</span>`;
            else badge = '<span class="badge warn">fail</span>';
          } else if (p.dead) {
            badge = '<span class="badge warn">мертвый</span>';
          } else {
            badge = '<span class="badge success">живой</span>';
          }
          const err = chk?.error
            ? `<div class="admin-acc__sub">${escapeHtml(chk.error)}</div>`
            : '';
          return `<div class="admin-proxy-row${p.dead ? ' is-dead' : ''}"><strong>${escapeHtml(p.label)}</strong> ${badge}${err}</div>`;
        })
        .join('');
      return `<div class="admin-proxy-block">${head}${rows}</div>`;
      })
      .join('');
}

function formatAdminLogLine(line) {
  let t = '—:—:—';
  try {
    t = new Date(line.ts).toLocaleTimeString('ru-RU', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch (_) {
    t = String(line.ts || '').slice(11, 19);
  }
  return `<div class="admin-log-line admin-log-line--${escapeHtml(line.level || 'info')}"><span class="admin-log-ts">${escapeHtml(t)}</span> ${escapeHtml(line.text || '')}</div>`;
}

async function loadAdminLogs(reset) {
  const box = document.getElementById('admin-log-console');
  if (!box) return;
  const data = await api.getAdminLogs(
    reset ? { limit: 400 } : { limit: 200, afterId: state.admin.logsAfterId || 0 },
  );
  const lines = data.lines || [];
  if (reset) {
    box.innerHTML = lines.map(formatAdminLogLine).join('') || '<div class="empty">пусто</div>';
    box.scrollTop = box.scrollHeight;
  } else if (lines.length) {
    box.insertAdjacentHTML('beforeend', lines.map(formatAdminLogLine).join(''));
    box.scrollTop = box.scrollHeight;
  }
  state.admin.logsAfterId = data.latestId || state.admin.logsAfterId;
}

function activityMatchesGroup(kind, group) {
  if (!group || group === 'all') return true;
  if (group === 'media') return kind === 'media_miss' || kind === 'media_sent';
  if (group === 'nft') return kind === 'nft_voice';
  if (group === 'lead') return kind === 'lead_ready' || kind === 'help_agreed';
  return kind === group;
}

function activityKindLabel(kind) {
  if (kind === 'media_miss' || kind === 'media_sent') return 'Фото';
  if (kind === 'nft_voice') return 'NFT';
  if (kind === 'lead_ready' || kind === 'help_agreed') return 'Лид';
  return kind || 'событие';
}

function activityKindClass(kind) {
  const k = String(kind || '');
  if (k.includes('media')) return 'is-media';
  if (k.includes('nft')) return 'is-nft';
  if (k.includes('lead') || k.includes('help')) return 'is-lead';
  return 'is-other';
}

function isSmokeActivityItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.meta && item.meta.smoke === true) return true;
  const title = String(item.title || '').trim().toLowerCase();
  if (/^smoke(\s|-|_)/.test(title) || title === 'smoke') return true;
  const label = String(item.accountLabel || '').trim().toLowerCase();
  if (/^smoke([-_]|$)/.test(label)) return true;
  const aid = Number(item.accountId);
  return Number.isFinite(aid) && aid >= 900000 && aid < 1000000;
}

function activityDisplayTitle(item) {
  const raw = String(item?.title || '').trim();
  if (!raw || isSmokeActivityItem(item)) {
    return activityKindLabel(item?.kind) === 'событие'
      ? 'Событие'
      : activityKindLabel(item?.kind);
  }
  return raw;
}

function formatActivityTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseActivityBody(body) {
  const lines = String(body || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const meta = [];
  const rest = [];
  for (const line of lines) {
    const m = line.match(
      /^(Аккаунт|Собеседник|Файл|Тип|Голосовое|Ответ(?:\s+собеседника)?)\s*:\s*(.+)$/i,
    );
    if (m) meta.push({ k: m[1], v: m[2] });
    else rest.push(line);
  }
  return { meta, rest };
}

function buildActivityMeta(item) {
  const parsed = parseActivityBody(item.body);
  if (parsed.meta.length) return parsed;
  const meta = [];
  if (item.accountLabel) meta.push({ k: 'Аккаунт', v: String(item.accountLabel) });
  if (item.peerLabel || item.peerId) {
    meta.push({
      k: 'Собеседник',
      v: String(item.peerLabel || item.peerId),
    });
  }
  return { meta, rest: parsed.rest };
}

function isWideActivityMetaKey(key) {
  const k = String(key || '').toLowerCase();
  return k.includes('ответ') || k.includes('файл') || k.includes('голос');
}

function renderActivityFeed(listEl, items, kind, filterAction) {
  if (!listEl) return;
  document.querySelectorAll(`[data-action="${filterAction}"]`).forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.akind === kind);
  });
  const rows = (items || []).filter(
    (item) => !isSmokeActivityItem(item) && activityMatchesGroup(item.kind, kind),
  );
  if (!rows.length) {
    listEl.innerHTML = '<p class="empty">Пока тихо</p>';
    return;
  }
  listEl.innerHTML = rows
    .map((item) => {
      const kindClass = activityKindClass(item.kind);
      const parsed = buildActivityMeta(item);
      const metaHtml = parsed.meta.length
        ? `<dl class="activity-meta">${parsed.meta
            .map(
              (row) =>
                `<div class="activity-meta__row${
                  isWideActivityMetaKey(row.k) ? ' is-wide' : ''
                }"><dt>${escapeHtml(row.k)}</dt><dd>${escapeHtml(row.v)}</dd></div>`,
            )
            .join('')}</dl>`
        : '';
      const restHtml = parsed.rest.length
        ? `<p class="activity-item__body">${escapeHtml(parsed.rest.join('\n'))}</p>`
        : !parsed.meta.length && item.body
          ? `<p class="activity-item__body">${escapeHtml(item.body)}</p>`
          : '';
      const time = formatActivityTime(item.createdAt);
      const replyText =
        parsed.meta.find((m) => /ответ/i.test(String(m.k || '')))?.v ||
        (parsed.rest.length ? parsed.rest.join(' ') : '') ||
        String(item.body || '').slice(0, 280);
      const badBtn =
        filterAction === 'admin-akind' && replyText
          ? `<button class="btn btn-secondary small activity-item__bad" type="button" data-action="admin-bad-reply" data-reply="${escapeHtml(replyText.slice(0, 400))}">Плохой ответ</button>`
          : '';
      return `
      <article class="activity-item ${kindClass}">
        <header class="activity-item__head">
          <div class="activity-item__topline">
            <span class="activity-kind">${escapeHtml(activityKindLabel(item.kind))}</span>
            ${time ? `<time class="activity-item__time">${escapeHtml(time)}</time>` : ''}
          </div>
          <strong class="activity-item__title">${escapeHtml(activityDisplayTitle(item))}</strong>
        </header>
        ${metaHtml}
        ${restHtml}
        ${badBtn}
      </article>`;
    })
    .join('');
}

async function loadAdminActivity() {
  const data = await api.getAdminActivity({ limit: 80 });
  state.admin.activity = data.events || data.items || [];
  renderAdminActivity();
}

function renderAdminActivity() {
  renderActivityFeed(
    document.getElementById('admin-activity-list'),
    state.admin.activity,
    state.admin.activityKind,
    'admin-akind',
  );
}

async function loadWorkerActivity() {
  try {
    const data = await api.getWorkerActivity({ limit: 60 });
    state.workerActivity.items = data.events || data.items || [];
  } catch (_) {
    state.workerActivity.items = [];
  }
  renderWorkerActivity();
}

function renderWorkerActivity() {
  renderActivityFeed(
    document.getElementById('worker-activity-list'),
    state.workerActivity.items,
    state.workerActivity.kind,
    'worker-akind',
  );
}

function stopWorkerActivityLive() {
  if (state.workerActivity.timer) {
    clearInterval(state.workerActivity.timer);
    state.workerActivity.timer = null;
  }
}

function syncWorkerActivityLive() {
  stopWorkerActivityLive();
  const live = document.getElementById('worker-activity-live');
  if (!live?.checked) return;
  state.workerActivity.timer = setInterval(() => {
    loadWorkerActivity().catch(() => {});
  }, 12000);
}

function adminAccInitials(name) {
  const parts = String(name || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase() || '??';
  }
  const one = parts[0] || '?';
  return one.slice(0, 2).toUpperCase();
}

function findAdminAccount(accountId) {
  const list = state.admin.console?.accounts?.list;
  if (!Array.isArray(list)) return null;
  return list.find((a) => String(a.id) === String(accountId)) || null;
}

function openAdminAccountInfo(accountId) {
  const account = findAdminAccount(accountId);
  if (!account) {
    notify(`Аккаунт #${accountId} не найден`);
    return;
  }
  closeAccountModal();

  const prompt = String(account.prompt || '').trim();
  const media = String(account.mediaChatLink || account.media_chat_link || '').trim();
  const hasPrompt = Boolean(prompt);
  const hasMedia = Boolean(media);
  const title = account.name || account.phone || `#${account.id}`;
  const phone = account.phone || '—';
  const owner = account.owner || account.ownerTg || '—';
  const promptPreview = hasPrompt
    ? escapeHtml(prompt.length > 900 ? `${prompt.slice(0, 900)}…` : prompt)
    : 'Не задан — автоответы без характера / AI может молчать.';
  const safeMedia = safeTelegramHref(media);
  const mediaHtml = safeMedia
    ? `<a class="admin-info-link" href="${escapeHtml(safeMedia)}" target="_blank" rel="noopener noreferrer">${escapeHtml(media)}</a>`
    : hasMedia
      ? escapeHtml(media)
      : 'Не подключен — фото и кружки из канала не уйдут.';

  const overlay = document.createElement('div');
  overlay.id = 'account-modal';
  overlay.className = 'modal-overlay drawer-overlay';
  overlay.innerHTML = `
    <div class="modal-card drawer-card" role="dialog" aria-modal="true" aria-label="Инфо аккаунта">
      <div class="modal-card__header">
        <div>
          <p class="modal-card__eyebrow">Админ · #${escapeHtml(account.id)}</p>
          <h3 class="modal-card__title">${escapeHtml(title)}</h3>
          <p class="modal-card__subphone">${escapeHtml(phone)} · владелец ${escapeHtml(owner)}</p>
        </div>
        <button class="modal-close" type="button" aria-label="Закрыть" data-modal-close>×</button>
      </div>

      <div class="modal-meta">
        <div class="modal-meta__item">
          <span class="modal-meta__label">Сеть</span>
          <span class="modal-meta__value ${account.online ? 'is-on' : 'is-off'}">${account.online ? 'Онлайн' : 'Офлайн'}</span>
        </div>
        <div class="modal-meta__item">
          <span class="modal-meta__label">Автоответ</span>
          <span class="modal-meta__value ${account.ai ? 'is-on' : 'is-off'}">${account.ai ? 'Включён' : 'Выключен'}</span>
        </div>
        <div class="modal-meta__item">
          <span class="modal-meta__label">Промпт</span>
          <span class="badge ${hasPrompt ? 'success' : 'warn'}">${hasPrompt ? 'Подключен' : 'Нет'}</span>
        </div>
        <div class="modal-meta__item">
          <span class="modal-meta__label">Медиа ТГК</span>
          <span class="badge ${hasMedia ? 'success' : 'warn'}">${hasMedia ? 'Подключен' : 'Нет'}</span>
        </div>
      </div>

      <div class="modal-field">
        <span>Медиа-канал</span>
        <div class="admin-info-block">${mediaHtml}</div>
      </div>

      <div class="modal-field">
        <span>Промпт ${hasPrompt ? `· ${prompt.length} знак.` : ''}</span>
        <pre class="admin-info-prompt">${promptPreview}</pre>
      </div>

      <div class="modal-meta admin-info-stats">
        <div class="modal-meta__item">
          <span class="modal-meta__label">Сегодня</span>
          <span class="modal-meta__value">${Number(account.sentToday || 0)}</span>
        </div>
        <div class="modal-meta__item">
          <span class="modal-meta__label">Неделя</span>
          <span class="modal-meta__value">${Number(account.sentWeek || 0)}</span>
        </div>
        <div class="modal-meta__item">
          <span class="modal-meta__label">Диалогов</span>
          <span class="modal-meta__value">${Number(account.peersTotal || 0)}</span>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-secondary" type="button" data-modal-close>Закрыть</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.addEventListener('keydown', onModalKeydown);
  document.body.classList.add('modal-open');
  setupMobileKeyboardHandling(overlay);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.hasAttribute('data-modal-close')) {
      closeAccountModal();
    }
  });
}

function renderAdmin() {
  if (!state.dashboard.isAdmin) return;
  syncAdminVisibility();
  syncAdminSubUi(state.admin.sub);

  const snap = state.admin.console || {};
  const acc = snap.accounts || {};
  const live = document.getElementById('admin-live');
  if (live) {
    live.textContent = `${Number(acc.online || 0)} онлайн · AI ${Number(acc.aiOn || 0)} · горячих ${Number(snap.hotLeads || 0)}`;
  }

  const summary = document.getElementById('admin-summary');
  if (summary) {
    const day = snap.messages?.day || {};
    const radar = snap.radar || {};
    const board = snap.funnelBoard || {};
    const cost = snap.cost?.today || {};
    const ph = snap.proxyHealth || {};
    const costLabel =
      cost.cost_usd != null ? `$${Number(cost.cost_usd).toFixed(2)}` : '—';
    summary.innerHTML = `
      <div class="stat-card"><strong>${Number(acc.total || 0)}</strong><span>Аккаунтов</span></div>
      <div class="stat-card"><strong>${Number(acc.online || 0)}</strong><span>Онлайн</span></div>
      <div class="stat-card"><strong>${Number(acc.aiOn || 0)}</strong><span>AI вкл</span></div>
      <div class="stat-card"><strong>${Number(snap.hotLeads || 0)}</strong><span>Горячие</span></div>
      <div class="stat-card"><strong>${Number(day.sent || 0)}</strong><span>Ответов сегодня</span></div>
      <div class="stat-card"><strong>${Number(day.incoming || 0)}</strong><span>Входящих сегодня</span></div>
      <div class="stat-card"><strong>${Number(radar.repliesPerHour || 0)}</strong><span>Ответов/час</span></div>
      <div class="stat-card"><strong>${Number(radar.staleAi || 0)}</strong><span>AI замолчал</span></div>
      <div class="stat-card"><strong>${Number(board.stuckWorkNoVoice || 0)}</strong><span>Stuck без ГС</span></div>
      <div class="stat-card"><strong>${Number(board.staleDialog || 0)}</strong><span>NFT закрыто (тишина)</span></div>
      <div class="stat-card"><strong>${Number(board.openWork || board.workPending || 0)}</strong><span>Ждут «по работе»</span></div>
      <div class="stat-card"><strong>${Number(board.liveDialog90 || 0)}</strong><span>Живые под ГС</span></div>
      <div class="stat-card"><strong>${Number(board.voice7d || board.campaignArchive?.voice7d || 0)}</strong><span>ГС за 7д</span></div>
      <div class="stat-card"><strong>${Number(board.campaignArchive?.workSent || board.workSent || 0)}</strong><span>Кампания: work ушло</span></div>
      <div class="stat-card"><strong>${Number(board.campaignArchive?.stuck || board.stuckWorkNoVoice || 0)}</strong><span>Архив: stuck</span></div>
      <div class="stat-card"><strong>${Number(board.campaignArchive?.stale || board.staleDialog || 0)}</strong><span>Архив: тишина</span></div>
      <div class="stat-card"><strong>${Number(ph.work_alive ?? ph.proxy_len ?? '—')}</strong><span>Прокси живые</span></div>
      <div class="stat-card"><strong>${escapeHtml(costLabel)}</strong><span>Токены сегодня</span></div>
      <div class="stat-card stat-card--accent nft-funnel-actions">
        <button class="btn btn-secondary small" type="button" data-action="admin-nft-expire">Закрыть мёртвые NFT</button>
        <span>Stuck → тишина</span>
      </div>
    `;
  }

  const list = document.getElementById('admin-accounts-list');
  if (list) {
    const rows = Array.isArray(acc.list) ? acc.list : [];
    if (!rows.length) {
      list.innerHTML = '<div class="empty-state"><p>Аккаунтов пока нет</p></div>';
    } else {
      list.innerHTML = rows
        .map((a) => {
          const rawName = a.name || a.phone || `#${a.id}`;
          const title = escapeHtml(rawName);
          const initials = escapeHtml(adminAccInitials(rawName));
          const phone = a.phone ? escapeHtml(a.phone) : '';
          const owner = escapeHtml(a.owner || a.ownerTg || '—');
          const hasPrompt = Boolean(String(a.prompt || '').trim());
          const hasMedia = Boolean(String(a.mediaChatLink || a.media_chat_link || '').trim());
          return `
            <article class="admin-acc ${a.ai ? 'admin-acc--ai-on' : 'admin-acc--ai-off'}" data-admin-acc="${escapeHtml(a.id)}">
              <div class="admin-acc__top">
                <div class="admin-acc__avatar ${a.online ? 'is-online' : 'is-offline'}" aria-hidden="true">${initials}</div>
                <div class="admin-acc__identity">
                  <div class="admin-acc__title">
                    <span class="admin-acc__name" title="${title}">${title}</span>
                  </div>
                  <div class="admin-acc__sub">${phone ? `<span class="admin-acc__phone">${phone}</span>` : ''}${
                    phone ? ' · ' : ''
                  }владелец ${owner}</div>
                </div>
                <span class="admin-acc__badge ${a.ai ? 'is-on' : 'is-off'}">${a.ai ? 'AI вкл' : 'AI выкл'}</span>
              </div>
              <div class="admin-acc__stats">
                <div class="admin-acc__stat">
                  <span class="admin-acc__stat-label">статус</span>
                  <strong>${a.online ? 'онлайн' : 'офлайн'}</strong>
                </div>
                <div class="admin-acc__stat">
                  <span class="admin-acc__stat-label">сегодня</span>
                  <strong>${Number(a.sentToday || 0)}</strong>
                </div>
                <div class="admin-acc__stat">
                  <span class="admin-acc__stat-label">неделя</span>
                  <strong>${Number(a.sentWeek || 0)}</strong>
                </div>
              </div>
              <div class="admin-acc__flags">
                <span class="admin-flag ${hasPrompt ? 'is-ok' : 'is-bad'}">${hasPrompt ? 'промпт' : 'нет промпта'}</span>
                <span class="admin-flag ${hasMedia ? 'is-ok' : 'is-bad'}">${hasMedia ? 'медиа' : 'нет медиа'}</span>
              </div>
              <div class="admin-acc__actions">
                ${
                  a.ai
                    ? `<button class="btn btn-secondary small" type="button" data-action="admin-ai-off" data-id="${escapeHtml(a.id)}">Стоп</button>`
                    : `<button class="btn btn-primary small" type="button" data-action="admin-ai-on" data-id="${escapeHtml(a.id)}">AI</button>`
                }
                <button class="btn btn-secondary small" type="button" data-action="admin-ping" data-id="${escapeHtml(a.id)}">Пинг</button>
                <button class="btn btn-secondary small" type="button" data-action="admin-persona-preview" data-id="${escapeHtml(a.id)}">Превью</button>
                <button class="btn btn-secondary small" type="button" data-action="admin-acc-info" data-id="${escapeHtml(a.id)}">Инфо</button>
                <button class="btn btn-danger small" type="button" data-action="admin-del" data-id="${escapeHtml(a.id)}">Удал.</button>
              </div>
            </article>`;
        })
        .join('');
    }
  }

  const bl = document.getElementById('admin-bl-list');
  if (bl) {
    const rows = state.admin.blacklist || [];
    if (!rows.length) {
      bl.innerHTML = '<p class="empty">ЧС пуст</p>';
    } else {
      bl.innerHTML = rows
        .map(
          (row) => `
          <div class="account-item">
            <div class="account-item__head">
              <strong>${escapeHtml(row.title || row.username || row.telegramId)}</strong>
              <button class="btn btn-danger small" type="button" data-action="admin-bl-del" data-id="${escapeHtml(row.telegramId)}">Снять</button>
            </div>
            <div class="account-item__sub">ID ${escapeHtml(row.telegramId || '')}${
              row.accounts != null ? ` · акк. ${escapeHtml(row.accounts)}` : ''
            }</div>
          </div>`,
        )
        .join('');
    }
  }

  if (state.admin.proxies) renderAdminProxies(null);
  renderAdminActivity();
}

function render() {
  syncAdminVisibility();
  renderPanel();
  renderAccounts();
  renderConversations();
  renderLearn();
  renderUpdates();
  renderOptions();
  renderStats();
  renderNotifications();
  if (state.dashboard.isAdmin && state.activeTab === 'admin') {
    renderAdmin();
  }
  setActiveTab(state.activeTab);
}

async function backgroundRefresh() {
  if (document.hidden) return;
  state.silentRefresh = true;
  try {
    const results = await Promise.allSettled([
      loadDashboard(),
      loadAccounts(),
      loadConversations(),
      loadStats(),
    ]);
    render();
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) {
      pushNotification(failed.reason?.message || 'Фоновое обновление с ошибкой', {
        silent: true,
      });
    }
  } catch (error) {
    console.error('[backgroundRefresh]', error);
  } finally {
    state.silentRefresh = false;
  }
}

function startBackgroundRefresh() {
  if (state.backgroundTimer) clearInterval(state.backgroundTimer);
  state.backgroundTimer = setInterval(backgroundRefresh, 45000);
}

/**
 * Состояние многошагового подключения аккаунта.
 * method: 'qr' | 'code'
 * step: 'phone' | 'code' | 'password' | 'qr'
 */
const connectState = {
  method: 'qr',
  step: 'qr',
  phone: '',
  prompt: '',
  qrPollTimer: null,
  qrStartedAt: 0,
};

function stopQrPoll() {
  if (connectState.qrPollTimer) {
    clearInterval(connectState.qrPollTimer);
    connectState.qrPollTimer = null;
  }
}

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

function showQrVisual(loginUrl, qrImage) {
  const box = document.getElementById('connect-qr-box');
  const img = document.getElementById('connect-qr-img');
  const link = document.getElementById('connect-qr-link');
  if (box) box.hidden = false;
  if (img) {
    if (qrImage) {
      // data: — без CDN; http — cache-bust, чтобы картинка менялась после входа
      const next =
        String(qrImage).startsWith('data:')
          ? qrImage
          : `${qrImage}${qrImage.includes('?') ? '&' : '?'}t=${Date.now()}`;
      if (img.src !== next) img.src = next;
      img.hidden = false;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
    }
  }
  if (link) {
    link.textContent = loginUrl || '';
    link.hidden = !loginUrl;
  }
}

function clearQrVisual() {
  const box = document.getElementById('connect-qr-box');
  const img = document.getElementById('connect-qr-img');
  const link = document.getElementById('connect-qr-link');
  if (box) box.hidden = true;
  if (img) {
    img.removeAttribute('src');
    img.hidden = true;
  }
  if (link) {
    link.textContent = '';
    link.hidden = true;
  }
}

function setConnectMethod(method) {
  connectState.method = method === 'code' ? 'code' : 'qr';
  stopQrPoll();
  clearQrVisual();

  document.querySelectorAll('[data-connect-method]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-connect-method') === connectState.method);
  });

  if (connectState.method === 'qr') {
    connectState.step = 'qr';
    connectState.phone = '';
    setConnectStep('qr');
    setConnectHint('');
  } else {
    connectState.step = 'phone';
    setConnectStep('phone');
    setConnectHint('Код придёт в приложение Telegram на этом номере (не SMS).');
  }
}

/**
 * Переключает форму между шагами: показывает нужные поля и меняет кнопку.
 */
function setConnectStep(step) {
  connectState.step = step;

  const method = connectState.method;
  const qrPanel = document.getElementById('connect-qr-panel');
  const phoneWrap = document.getElementById('account-phone-field');
  const codeField = document.getElementById('account-code-field');
  const passwordField = document.getElementById('account-password-field');
  const promptField = document.getElementById('account-prompt-field');
  const phoneField = document.getElementById('account-phone');
  const submitButton = document.getElementById('account-submit');

  // QR: инструкция/картинка. Пароль — ТОЛЬКО когда Telegram реально вернул needPassword.
  // Раньше поле 2FA светилось на всём входе по коду → воркеры думали, что пароль обязателен.
  const showQr = method === 'qr' && step !== 'password';
  const showPhone = method === 'code';
  const showCode = method === 'code' && step !== 'password';
  const showPassword = step === 'password';
  // Промпт нужен и для QR — иначе AI молчит (пустой prompt).
  const showPrompt = true;

  if (qrPanel) qrPanel.hidden = !showQr;
  if (phoneWrap) phoneWrap.hidden = !showPhone;
  if (codeField) codeField.hidden = !showCode;
  if (passwordField) passwordField.hidden = !showPassword;
  if (promptField) promptField.hidden = !showPrompt;

  if (phoneField) {
    phoneField.readOnly = method === 'code' && step !== 'phone' && step !== 'code';
    phoneField.required = method === 'code' && step === 'phone';
  }

  // На шаге phone код/пароль ещё не обязательны; на code — код; на password — пароль.
  const codeInput = document.getElementById('account-code');
  const passInput = document.getElementById('account-password');
  if (codeInput) codeInput.required = method === 'code' && step === 'code';
  if (passInput) passInput.required = step === 'password';

  if (submitButton) {
    const labels = {
      qr: 'Показать QR',
      phone: 'Получить код',
      code: 'Подтвердить код',
      password: 'Подтвердить пароль',
    };
    submitButton.textContent = labels[step] || 'Продолжить';
  }
}

/**
 * Сбрасывает форму подключения в начальное состояние.
 * keepPrompt — после успешного входа оставляем промпт для следующего QR.
 */
function resetConnectForm({ keepPrompt = false } = {}) {
  stopQrPoll();
  clearQrVisual();
  connectState.phone = '';
  connectState.qrStartedAt = 0;
  const savedPrompt = keepPrompt
    ? connectState.prompt || document.getElementById('account-prompt')?.value?.trim() || ''
    : '';
  if (!keepPrompt) connectState.prompt = '';

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
  if (promptField) {
    promptField.value = keepPrompt ? savedPrompt : '';
  }
  if (keepPrompt && savedPrompt) connectState.prompt = savedPrompt;

  setConnectMethod(connectState.method || 'qr');
  setConnectHint('');
}

/** Старт свежего QR (после входа или по кнопке). */
async function startFreshQrSession({ afterConnect = false } = {}) {
  const prompt =
    connectState.prompt || document.getElementById('account-prompt')?.value?.trim() || '';
  if (!prompt) {
    setConnectHint('Сначала вставь промпт персонажа — без него AI не отвечает.');
    notify('Нужен промпт');
    return false;
  }
  connectState.prompt = prompt;
  const promptField = document.getElementById('account-prompt');
  if (promptField && !promptField.value.trim()) promptField.value = prompt;

  stopQrPoll();
  clearQrVisual();
  setConnectStep('qr');
  setConnectHint(afterConnect ? 'Готовлю новый QR для следующего номера…' : 'Готовлю QR…');

  const started = await api.connectQrStart(prompt);
  if (started.status === 'connected') {
    // Уже авторизован на этом токене — не зацикливаем finish→start.
    if (afterConnect) {
      setConnectHint('Готово. Нажми «Показать QR», когда будешь подключать следующий номер.');
      return true;
    }
    await finishConnect();
    return true;
  }
  if (started.status === 'needPassword') {
    connectState.phone = 'qr';
    setConnectStep('password');
    setConnectHint('Аккаунт защищён паролем. Введите облачный пароль (2FA).');
    return true;
  }
  showQrVisual(started.loginUrl, started.qrImage);
  connectState.qrStartedAt = Date.now();
  setConnectHint(
    'Отсканируй QR в Telegram → Устройства. После входа появится новый код — можно сразу следующий номер.',
  );
  stopQrPoll();
  connectState.qrPollTimer = setInterval(handleQrPollTick, 3500);
  setTimeout(handleQrPollTick, 2000);
  return true;
}

/**
 * Завершение подключения: обновляем данные и сразу крутим новый QR.
 */
async function finishConnect() {
  stopQrPoll();
  const keepPrompt =
    connectState.prompt || document.getElementById('account-prompt')?.value?.trim() || '';
  await Promise.all([
    loadDashboard(),
    loadAccounts(),
  ]);

  resetConnectForm({ keepPrompt: true });
  render();
  notify('Аккаунт подключён');

  if (keepPrompt && connectState.method === 'qr') {
    try {
      await startFreshQrSession({ afterConnect: true });
      notify('Новый QR готов — сканируй следующий');
    } catch (err) {
      setConnectHint(
        'Аккаунт сохранён. Нажми «Показать QR» для следующего номера — перезаходить в миниапп не нужно.',
      );
      handleRequestError(err);
    }
  }
}

async function handleQrPollTick() {
  try {
    const st = await api.connectQrPoll(connectState.prompt);
    if (st.status === 'pending') {
      if (st.loginUrl) showQrVisual(st.loginUrl, st.qrImage);
      return;
    }
    if (st.status === 'needPassword') {
      stopQrPoll();
      connectState.phone = 'qr';
      setConnectStep('password');
      setConnectHint(
        'Telegram просит облачный пароль (Настройки → Конфиденциальность → Двухэтапная проверка). Если там пароля нет — отмени и войди заново новым QR.',
      );
      return;
    }
    if (st.status === 'connected') {
      await finishConnect();
    }
  } catch (error) {
    stopQrPoll();
    handleRequestError(error);
    setConnectStep('qr');
  }
}

/**
 * Обработчик формы подключения. QR или телефон → код → (2FA).
 */
async function addAccount(event) {
  event.preventDefault();

  const submitButton = document.getElementById('account-submit');
  if (submitButton) submitButton.disabled = true;

  try {
    const promptField = document.getElementById('account-prompt');
    connectState.prompt = promptField?.value.trim() || connectState.prompt || '';
    if (!connectState.prompt) {
      setConnectHint('Сначала вставь промпт персонажа — без него AI не отвечает.');
      notify('Нужен промпт');
      return;
    }

    if (connectState.step === 'qr') {
      if (submitButton) submitButton.textContent = 'Готовлю QR…';
      setConnectHint('Подключаюсь через прокси (обычно 3–8 сек)…');
      await startFreshQrSession();
      notify('QR готов — сканируй');
      return;
    }

    if (connectState.step === 'phone') {
      const phoneField = document.getElementById('account-phone');
      const phone = phoneField?.value.trim() || '';

      if (!phone) {
        notify('Введите номер телефона');
        return;
      }

      if (submitButton) submitButton.textContent = 'Отправляю…';
      const startResult = await api.connectStart(phone);
      connectState.phone = phone;
      setConnectStep('code');
      setConnectHint(
        startResult?.viaApp
          ? 'Код ушёл в приложение Telegram на этом номере (не SMS). Открой Telegram → уведомление «Код для входа».'
          : 'Код отправлен (SMS или звонок / Telegram). Введите его выше.',
      );
      notify(startResult?.viaApp ? 'Код в приложении Telegram' : 'Код отправлен');
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
        setConnectHint(
          'Telegram просит облачный пароль (Настройки → Конфиденциальность → Двухэтапная проверка). Если там пароля нет — отмени и запроси код заново.',
        );
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
        connectState.phone || 'qr',
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
    // Вернуть подпись кнопки после «Отправляю…» / ошибки.
    setConnectStep(connectState.step);
  }
}

function bindConnectMethodButtons() {
  document.querySelectorAll('[data-connect-method]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setConnectMethod(btn.getAttribute('data-connect-method'));
    });
  });
}

/**
 * Удаление Telegram-аккаунта.
 */
async function handleDelete(accountId) {
  if (!accountId) return;
  if (!window.confirm('Удалить аккаунт и его сессию? Это нельзя отменить.')) {
    return;
  }
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
function startAiChecklist(account) {
  const gaps = [];
  if (!account) return ['аккаунт'];
  const prompt = String(account.prompt || account.persona || '').trim();
  if (prompt.length < 40) gaps.push('анкета (мало текста)');
  if (!account.is_online && account.online !== true) gaps.push('не в сети');
  return gaps;
}

async function handleAiToggle(accountId) {
  try {
    const account = (state.accounts || []).find((a) => String(a.id) === String(accountId));
    const gaps = startAiChecklist(account);
    if (gaps.length) {
      const ok = window.confirm(
        `Перед стартом AI проверь:\n• ${gaps.join('\n• ')}\n\nВсё равно включить?`,
      );
      if (!ok) return;
    }
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

async function handleBulkAiToggle(enabled, ids = null) {
  const selected = Array.isArray(ids) ? ids : null;
  const scope = selected?.length
    ? `на выбранных (${selected.length})`
    : 'на всех аккаунтах';
  const actionLabel = enabled ? `включить AI ${scope}` : `выключить AI ${scope}`;
  if (!window.confirm(`Точно ${actionLabel}?`)) return;

  try {
    if (enabled) {
      await api.bulkStartAi(selected);
    } else {
      await api.bulkStopAi(selected);
    }

    await Promise.all([loadAccounts(), loadDashboard(), loadStats()]);
    render();
    notify(enabled ? `AI включен ${scope}` : `AI выключен ${scope}`);
  } catch (error) {
    handleRequestError(error);
  }
}

async function handleSelectedBulkAi(enabled) {
  const ids = [...state.selectedAccountIds];
  if (!ids.length) {
    notify('Сначала выбери аккаунты в списке');
    return;
  }
  await handleBulkAiToggle(enabled, ids);
}

function clearAccountSelection() {
  state.selectedAccountIds.clear();
  persistSelection();
  renderAccounts();
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
    openBlacklistPanel();
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
    openBlacklistPanel();
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
  if (!window.confirm('Стереть историю этого диалога? ИИ забудет переписку.')) {
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

function openExportModal(text, count) {
  closeAccountModal();
  const overlay = document.createElement('div');
  overlay.id = 'account-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card export-modal" role="dialog" aria-modal="true" aria-label="Экспорт диалога">
      <div class="modal-card__header">
        <div>
          <p class="modal-card__eyebrow">Экспорт</p>
          <h3 class="modal-card__title">${escapeHtml(String(count || 0))} сообщ.</h3>
        </div>
        <button class="modal-close" type="button" aria-label="Закрыть" data-modal-close>×</button>
      </div>
      <textarea class="export-modal__text" readonly rows="14">${escapeHtml(text)}</textarea>
      <div class="modal-actions">
        <button class="btn btn-primary full" type="button" data-action="copy-export">Копировать</button>
        <button class="btn btn-secondary full" type="button" data-modal-close>Закрыть</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  document.addEventListener('keydown', onModalKeydown);

  const area = overlay.querySelector('.export-modal__text');
  overlay.addEventListener('click', async (event) => {
    if (event.target === overlay || event.target.closest('[data-modal-close]')) {
      closeAccountModal();
      return;
    }
    const copyBtn = event.target.closest('[data-action="copy-export"]');
    if (!copyBtn) return;
    const value = area?.value || text;
    try {
      await navigator.clipboard.writeText(value);
      notify('Скопировано');
    } catch (_) {
      try {
        area?.focus();
        area?.select();
        document.execCommand('copy');
        notify('Скопировано');
      } catch (err) {
        notify('Выдели текст вручную и скопируй');
      }
    }
  });
}

async function handleExportChat(accountId, peerId) {
  if (!accountId || !peerId) return;
  try {
    const data = await api.exportConversation(accountId, peerId);
    const text = data?.text || '';
    if (!text.trim()) {
      notify('Диалог пустой');
      return;
    }
    openExportModal(text, data.count || 0);
  } catch (error) {
    handleRequestError(error);
  }
}

async function handleToExamples(accountId, peerId) {
  if (!accountId || !peerId) return;
  if (
    !window.confirm(
      'Сохранить последние пары ответов в «Учить» и RAG? Повтор добавит дубликаты.',
    )
  ) {
    return;
  }
  try {
    const data = await api.conversationToExamples(accountId, peerId, {
      limit: 8,
      toRag: true,
    });
    const t = Number(data?.trainingAdded) || 0;
    const r = Number(data?.ragAdded) || 0;
    if (!t && !r) {
      notify('Нет пар user→assistant для сохранения');
      return;
    }
    try {
      await loadExamples();
    } catch (_) {
      /* вкладка Учить может быть не открыта */
    }
    notify(`В примеры: ${t}, в RAG: ${r}`);
  } catch (error) {
    handleRequestError(error);
  }
}

async function handleDeleteExample(id) {
  if (id === null || id === undefined || id === '') return;
  if (!window.confirm('Удалить этот пример?')) return;
  try {
    await api.deleteExample(id);
    await loadExamples();
    render();
    notify('Пример удалён');
  } catch (error) {
    handleRequestError(error);
  }
}

async function handlePauseBot(accountId, peerId, paused) {
  if (!accountId || !peerId) return;
  try {
    await api.pauseConversationBot(accountId, peerId, paused);
    await loadConversations();
    render();
    notify(paused ? 'ИИ на паузе — можно писать вручную' : 'ИИ снова отвечает в этом чате');
  } catch (error) {
    handleRequestError(error);
  }
}

async function handleFocusLead(accountId, peerId, focus) {
  if (!accountId || !peerId) return;
  try {
    await api.focusConversation(accountId, peerId, focus);
    await loadConversations();
    render();
    notify(focus ? 'Лид в фокусе' : 'Фокус снят');
  } catch (error) {
    handleRequestError(error);
  }
}

async function handleFunnelStage(accountId, peerId, stage) {
  if (!accountId || !peerId) return;
  try {
    await api.setFunnelStage(accountId, peerId, stage || 'auto');
    await loadConversations();
    render();
    notify(stage && stage !== 'auto' ? `Этап: ${state.funnelLabels[stage] || stage}` : 'Этап: авто');
  } catch (error) {
    handleRequestError(error);
  }
}

async function reloadConversationsView() {
  try {
    await loadConversations();
    render();
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
    openBlacklistPanel();
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
    openPhotoExceptionsPanel();
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
    openPhotoExceptionsPanel();
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
    openPhotoExceptionsPanel();
    notify('Список исключений очищен');
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
  overlay.className = 'modal-overlay drawer-overlay';

  overlay.innerHTML = `
    <div class="modal-card drawer-card" role="dialog" aria-modal="true" aria-label="Детали аккаунта">
      <div class="modal-card__header">
        <div>
          <p class="modal-card__eyebrow">Карточка аккаунта</p>
          <h3 class="modal-card__title">${escapeHtml(formatAccountTitle(account))}</h3>
          ${
            formatAccountSub(account)
              ? `<p class="modal-card__subphone">${escapeHtml(formatAccountSub(account))}</p>`
              : ''
          }
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
      bindConnectMethodButtons();
      setConnectMethod('qr');
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

  if (elements.addPhotoException) {
    elements.addPhotoException.addEventListener('click', handleAddPhotoException);
  }

  if (elements.clearPhotoExceptions) {
    elements.clearPhotoExceptions.addEventListener('click', handleClearPhotoExceptions);
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

    if (action === 'open-leads') {
      setActiveTab('leads');
      return;
    }

    if (action === 'refresh') {
      handleRefresh();
      return;
    }

    if (action === 'refresh-tasks') {
      loadWorkerTasks().catch(() => {});
      return;
    }

    if (action === 'done-task') {
      (async () => {
        try {
          await api.doneWorkerTask(id);
          notify('Задача закрыта');
          await loadWorkerTasks();
        } catch (e) {
          handleRequestError(e);
        }
      })();
      return;
    }

    if (action === 'logout') {
      const webApp = getTg();
      if (webApp && typeof webApp.close === 'function') {
        webApp.close();
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

    if (action === 'bulk-start') {
      handleBulkAiToggle(true);
      return;
    }

    if (action === 'bulk-stop') {
      handleBulkAiToggle(false);
      return;
    }

    if (action === 'bulk-selected-start') {
      handleSelectedBulkAi(true);
      return;
    }

    if (action === 'bulk-selected-stop') {
      handleSelectedBulkAi(false);
      return;
    }

    if (action === 'clear-selection') {
      clearAccountSelection();
      return;
    }

    if (action === 'toggle-notifications') {
      toggleNotifications();
      return;
    }

    if (action === 'clear-notifications') {
      clearNotifications();
      return;
    }

    if (action === 'open-media-gallery') {
      openMediaGallery();
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

    if (action === 'delete-example') {
      handleDeleteExample(id);
      return;
    }

    if (action === 'delete-photo-exception') {
      deletePhotoExceptionItem(id);
      return;
    }

    if (action === 'open-info') {
      setActiveTab('info');
      return;
    }

    if (action === 'open-admin') {
      if (!state.dashboard.isAdmin) {
        notify('Только для админов');
        return;
      }
      setActiveTab('admin');
      return;
    }

    if (action === 'admin-refresh' || action === 'admin-activity-refresh' || action === 'admin-bl-refresh') {
      loadAdminData({ force: true }).catch((err) => handleRequestError(err));
      return;
    }

    if (action === 'admin-sub') {
      setAdminSub(target.dataset.sub);
      return;
    }

    if (action === 'admin-akind') {
      state.admin.activityKind = target.dataset.akind || 'all';
      renderAdminActivity();
      return;
    }

    if (action === 'worker-activity-refresh') {
      loadWorkerActivity()
        .then(() => notify('События обновлены'))
        .catch((err) => handleRequestError(err));
      return;
    }

    if (action === 'worker-akind') {
      state.workerActivity.kind = target.dataset.akind || 'all';
      renderWorkerActivity();
      return;
    }

    if (action === 'admin-ai-on') {
      api
        .adminStartAi(id)
        .then(() => loadAdminData({ force: true }))
        .then(() => notify('AI включён'))
        .catch((err) => handleRequestError(err));
      return;
    }

    if (action === 'admin-ai-off') {
      api
        .adminStopAi(id)
        .then(() => loadAdminData({ force: true }))
        .then(() => notify('AI выключен'))
        .catch((err) => handleRequestError(err));
      return;
    }

    if (action === 'admin-ping') {
      api
        .adminPing(id)
        .then((r) => notify(r.ok || r.online ? 'Связь ок' : r.error || 'Пинг без ответа'))
        .catch((err) => handleRequestError(err));
      return;
    }

    if (action === 'admin-persona-preview') {
      api
        .getAdminPersonaPreview(id)
        .then((r) => {
          const p = r.preview || {};
          const lines = (p.samples || []).join('\n· ');
          notify(
            `${p.name || 'Анкета'}${p.city ? ` · ${p.city}` : ''}\n· ${lines || 'нет образца'}`,
          );
        })
        .catch((err) => handleRequestError(err));
      return;
    }

    if (action === 'admin-bad-reply') {
      const reply = String(target.dataset.reply || '').trim();
      if (!reply) return;
      api
        .adminFlagBadReply({ reply, trigger: 'admin:activity' })
        .then(() => notify('Запомнили как плохой ответ'))
        .catch((err) => handleRequestError(err));
      return;
    }

    if (action === 'admin-nft-expire') {
      if (!confirm('Закрыть мёртвые слоты после «по работе» (тишина / просрок)?')) return;
      api
        .adminExpireNftStale()
        .then((r) => {
          notify(
            `Закрыто ${Number(r.expired || 0)} · stuck ${Number(r.stuckWorkNoVoice || 0)} · ждут ${Number(r.openWork || 0)}`,
          );
          return loadAdminData({ force: true });
        })
        .catch((err) => handleRequestError(err));
      return;
    }

    if (action === 'admin-card-hint' || action === 'admin-acc-info') {
      openAdminAccountInfo(id);
      return;
    }

    if (action === 'admin-del') {
      if (!confirm(`Удалить аккаунт #${id}? Сессия тоже сбросится.`)) return;
      api
        .adminDeleteAccount(id)
        .then(() => loadAdminData({ force: true }))
        .then(() => notify(`Удалён #${id}`))
        .catch((err) => handleRequestError(err));
      return;
    }

    if (action === 'admin-bulk-ai-on') {
      if (!confirm('Включить AI на всех аккаунтах?')) return;
      api
        .adminBulkAiOn()
        .then((r) => {
          notify(`AI включён: ${r.ok ?? 0}` + (r.fail ? `, ошибок ${r.fail}` : ''));
          return loadAdminData({ force: true });
        })
        .catch((err) => handleRequestError(err));
      return;
    }

    if (action === 'admin-bulk-ai-off') {
      if (!confirm('Выключить AI на всех аккаунтах?')) return;
      api
        .adminBulkAiOff()
        .then((r) => {
          notify(`AI выключен: ${r.ok ?? 0}` + (r.fail ? `, ошибок ${r.fail}` : ''));
          return loadAdminData({ force: true });
        })
        .catch((err) => handleRequestError(err));
      return;
    }

    if (action === 'admin-bl-add') {
      const input = document.getElementById('admin-bl-input');
      const raw = String(input?.value || '').trim();
      if (!raw) {
        notify('Укажи @username или ID');
        return;
      }
      if (!confirm(`В ЧС: ${raw}?`)) return;
      api
        .addAdminBlacklist(raw)
        .then(() => {
          if (input) input.value = '';
          notify('В чёрном списке');
          return loadAdminData({ force: true });
        })
        .catch((err) => handleRequestError(err));
      return;
    }

    if (action === 'admin-bl-del') {
      if (!confirm('Снять с ЧС?')) return;
      api
        .deleteAdminBlacklist(id)
        .then(() => {
          notify('Снято с ЧС');
          return loadAdminData({ force: true });
        })
        .catch((err) => handleRequestError(err));
      return;
    }

    if (action === 'admin-add-create') {
      const payload = adminAddPayload();
      if (!payload.phone) {
        notify('Укажи телефон');
        return;
      }
      setAdminAddStatus('Создаю…');
      api
        .adminCreateAccount(payload)
        .then((r) => {
          setAdminAddStatus(`Создан #${r.account?.id} ${r.account?.phone || ''}`);
          notify('Аккаунт создан');
          return loadAdminData({ force: true });
        })
        .catch((err) => {
          setAdminAddStatus(err.message || 'Ошибка');
          handleRequestError(err);
        });
      return;
    }

    if (action === 'admin-add-code') {
      const payload = adminAddPayload();
      if (!payload.phone) {
        notify('Укажи телефон');
        return;
      }
      setAdminAddStatus('Запрашиваю код…');
      api
        .adminConnectStart(payload)
        .then((r) => {
          state.admin.connect = { ...payload, phone: r.phone || payload.phone };
          const codeWrap = document.getElementById('admin-add-code-wrap');
          const twoWrap = document.getElementById('admin-add-2fa-wrap');
          if (codeWrap) codeWrap.hidden = false;
          if (twoWrap) twoWrap.hidden = true;
          setAdminAddStatus(
            r.viaApp
              ? 'Код ушёл в приложение Telegram — введи ниже'
              : 'Код отправлен — введи ниже',
          );
          notify('Код запрошен');
        })
        .catch((err) => {
          setAdminAddStatus(err.message || 'Ошибка');
          handleRequestError(err);
        });
      return;
    }

    if (action === 'admin-add-resend') {
      if (!state.admin.connect) {
        notify('Сначала запроси код');
        return;
      }
      api
        .adminConnectResend(state.admin.connect)
        .then(() => {
          setAdminAddStatus('Код запрошен снова');
          notify('Код снова');
        })
        .catch((err) => {
          setAdminAddStatus(err.message || 'Ошибка');
          handleRequestError(err);
        });
      return;
    }

    if (action === 'admin-add-confirm-code') {
      if (!state.admin.connect) {
        notify('Сначала запроси код');
        return;
      }
      const code = String(document.getElementById('admin-add-code')?.value || '').trim();
      if (!code) {
        notify('Введи код');
        return;
      }
      setAdminAddStatus('Проверяю код…');
      api
        .adminConnectCode({ ...state.admin.connect, code })
        .then((r) => {
          if (r.status === 'needPassword') {
            const twoWrap = document.getElementById('admin-add-2fa-wrap');
            if (twoWrap) twoWrap.hidden = false;
            setAdminAddStatus('Нужен облачный пароль 2FA');
            return;
          }
          document.getElementById('admin-add-code-wrap').hidden = true;
          document.getElementById('admin-add-2fa-wrap').hidden = true;
          setAdminAddStatus(
            `Подключен #${r.accountId} · ${r.online ? 'online' : 'offline'}`,
          );
          notify('Подключен');
          return loadAdminData({ force: true });
        })
        .catch((err) => {
          setAdminAddStatus(err.message || 'Ошибка');
          handleRequestError(err);
        });
      return;
    }

    if (action === 'admin-add-confirm-2fa') {
      if (!state.admin.connect) {
        notify('Сначала запроси код');
        return;
      }
      const password = String(document.getElementById('admin-add-2fa')?.value || '');
      if (!password) {
        notify('Введи пароль 2FA');
        return;
      }
      setAdminAddStatus('Проверяю 2FA…');
      api
        .adminConnectPassword({ ...state.admin.connect, password })
        .then((r) => {
          document.getElementById('admin-add-code-wrap').hidden = true;
          document.getElementById('admin-add-2fa-wrap').hidden = true;
          setAdminAddStatus(
            `Подключен #${r.accountId} · ${r.online ? 'online' : 'offline'}`,
          );
          notify('Подключен');
          return loadAdminData({ force: true });
        })
        .catch((err) => {
          setAdminAddStatus(err.message || 'Ошибка');
          handleRequestError(err);
        });
      return;
    }

    if (action === 'admin-proxy-refresh') {
      loadAdminProxies()
        .then(() => notify('Прокси обновлены'))
        .catch((err) => handleRequestError(err));
      return;
    }

    if (action === 'admin-proxy-check') {
      const hint = document.getElementById('admin-proxy-hint');
      if (hint) hint.textContent = 'Проверяю SOCKS…';
      const run = async () => {
        if (!state.admin.proxies) await loadAdminProxies();
        const data = await api.checkAdminProxies('all');
        const map = {};
        for (const r of data.results || []) {
          map[`${r.kind}:${r.index}`] = r;
        }
        renderAdminProxies(map);
        if (hint) {
          hint.textContent = `ok ${data.ok} · fail ${data.fail} · skip ${data.skipped} → ${data.dest}`;
        }
        notify(`ok ${data.ok} / fail ${data.fail}`);
      };
      run().catch((err) => handleRequestError(err));
      return;
    }

    if (action === 'admin-logs-refresh') {
      loadAdminLogs(true)
        .then(() => notify('Логи обновлены'))
        .catch((err) => handleRequestError(err));
      return;
    }

    if (action === 'admin-logs-clear') {
      if (!confirm('Очистить буфер логов?')) return;
      api
        .clearAdminLogs()
        .then(() => {
          state.admin.logsAfterId = 0;
          const box = document.getElementById('admin-log-console');
          if (box) box.innerHTML = '<div class="empty">пусто</div>';
          notify('Логи очищены');
        })
        .catch((err) => handleRequestError(err));
      return;
    }

    if (action === 'clear-history') {
      handleClearHistory(target.dataset.account, target.dataset.peer);
      return;
    }

    if (action === 'export-chat') {
      handleExportChat(target.dataset.account, target.dataset.peer);
      return;
    }

    if (action === 'bad-reply-toggle') {
      const wrap = target.closest('.bad-reply-wrap');
      const panel = wrap?.querySelector('.bad-reply-reasons');
      if (panel) panel.hidden = !panel.hidden;
      return;
    }
    if (action === 'bad-reply') {
      const accountId = target.dataset.account;
      const peerId = target.dataset.peer;
      const reason = target.dataset.reason || 'other';
      const stage = state.conversationsStage || 'general';
      api
        .flagBadReply(accountId, peerId, { reason, stage })
        .then(() => {
          notify(
            reason === 'echo'
              ? 'Пометили: эхо'
              : reason === 'offtopic'
                ? 'Пометили: мимо темы'
                : reason === 'robot'
                  ? 'Пометили: робот'
                  : 'Пометили как плохой ответ',
          );
          const wrap = target.closest('.bad-reply-wrap');
          const panel = wrap?.querySelector('.bad-reply-reasons');
          if (panel) panel.hidden = true;
        })
        .catch((err) => handleRequestError(err));
      return;
    }
    if (action === 'to-examples') {
      handleToExamples(target.dataset.account, target.dataset.peer);
      return;
    }

    if (action === 'pause-bot') {
      handlePauseBot(
        target.dataset.account,
        target.dataset.peer,
        target.dataset.paused === '1',
      );
      return;
    }

    if (action === 'focus-lead') {
      handleFocusLead(
        target.dataset.account,
        target.dataset.peer,
        target.dataset.focus === '1',
      );
      return;
    }

    if (action === 'conv-sort-funnel') {
      state.conversationsSort = 'funnel';
      reloadConversationsView();
      return;
    }

    if (action === 'conv-sort-score') {
      state.conversationsSort = 'score';
      reloadConversationsView();
      return;
    }

    if (action === 'conv-sort-recent') {
      state.conversationsSort = 'recent';
      reloadConversationsView();
      return;
    }

    if (action === 'conv-hot-only') {
      state.conversationsHotOnly = !state.conversationsHotOnly;
      reloadConversationsView();
      return;
    }

    if (action === 'dismiss-onboard') {
      try {
        localStorage.setItem('lr-funnel-onboard-v1', '1');
      } catch (_) {}
      renderConversations();
      return;
    }
    if (action === 'funnel-filter') {
      state.conversationsStage = target.dataset.stage || '';
      reloadConversationsView();
    }
  });

  document.addEventListener('change', (event) => {
    const select = event.target.closest('select[data-action="funnel-stage"]');
    if (select) {
    handleFunnelStage(select.dataset.account, select.dataset.peer, select.value);
      return;
    }

    if (event.target?.id === 'worker-activity-live') {
      syncWorkerActivityLive();
      return;
    }

    const selectAll = event.target.closest('[data-action="select-all-accounts"]');
    if (selectAll) {
      const on = !!selectAll.checked;
      state.accounts.forEach((account) => setAccountSelected(account.id, on));
      renderAccounts();
      return;
    }

    const rowCheck = event.target.closest('[data-action="select-account"]');
    if (rowCheck) {
      setAccountSelected(rowCheck.dataset.id, !!rowCheck.checked);
      const row = rowCheck.closest('.account-card, [data-account-row], tr');
      if (row) row.classList.toggle('is-selected', !!rowCheck.checked);
      const allBox = document.querySelector('[data-action="select-all-accounts"]');
      if (allBox) {
        allBox.checked =
          state.accounts.length > 0 &&
          state.accounts.every((a) => isAccountSelected(a.id));
      }
    }
  });
}

/**
 * Основной запуск: биндим события, рисуем интерфейс
 * и подтягиваем реальные данные из backend.
 */
/** Именительный → «в X» (предложный). Зеркало personaFacts.inCityPrep. */
function cityInPrep(name) {
  const n = String(name || '').trim();
  if (!n) return n;
  if (
    /^(?:Москве|Анапе|Сочи|Липецке|Белгороде|Курске|Калуге|Воронеже|Краснодаре|Ростове|Самаре|Казани|Твери|Туле|Рязани|Тимашевске|Красноярске|Иванове|Нижнем(?:\s+Новгороде)?|Великом\s+Новгороде)$/i.test(
      n,
    )
  ) {
    return n;
  }
  if (/^нижн/i.test(n)) return /новгород/i.test(n) ? 'Нижнем Новгороде' : 'Нижнем';
  if (/^велик/i.test(n) && /новгород/i.test(n)) return 'Великом Новгороде';
  if (/^москв/i.test(n)) return 'Москве';
  if (/^анап/i.test(n)) return 'Анапе';
  if (/^липецк/i.test(n)) return 'Липецке';
  if (/^тимашевск/i.test(n)) return 'Тимашевске';
  if (/^красноярск/i.test(n)) return 'Красноярске';
  if (/^иванов/i.test(n)) return 'Иванове';
  const map = {
    Москва: 'Москве',
    Анапа: 'Анапе',
    Сочи: 'Сочи',
    Липецк: 'Липецке',
    Белгород: 'Белгороде',
    Курск: 'Курске',
    Калуга: 'Калуге',
    Воронеж: 'Воронеже',
    Краснодар: 'Краснодаре',
    Ростов: 'Ростове',
    Самара: 'Самаре',
    Казань: 'Казани',
    Тверь: 'Твери',
    Тула: 'Туле',
    Рязань: 'Рязани',
    Тимашевск: 'Тимашевске',
    Красноярск: 'Красноярске',
    Иваново: 'Иванове',
    'Нижний Новгород': 'Нижнем Новгороде',
    Нижний: 'Нижнем',
    'Великий Новгород': 'Великом Новгороде',
  };
  if (map[n]) return map[n];
  if (/[ая]$/i.test(n)) return n.replace(/[ая]$/i, 'е');
  if (/о$/i.test(n)) return n.replace(/о$/i, 'е');
  if (/ь$/i.test(n)) return n.replace(/ь$/i, 'и');
  if (/ий$/i.test(n)) return n.replace(/ий$/i, 'ем');
  if (/([бвгджзклмнпрстфхцчшщ])$/i.test(n)) return `${n}е`;
  return n;
}

/** Именительный → «в X» (винительный). Зеркало personaFacts.inCityAcc. */
function cityInAcc(name) {
  const n = String(name || '').trim();
  if (!n) return n;
  if (/^москв/i.test(n)) return 'Москву';
  if (/^анап/i.test(n)) return 'Анапу';
  if (/^калуг/i.test(n)) return 'Калугу';
  if (/^самар/i.test(n)) return 'Самару';
  if (/^казан/i.test(n)) return 'Казань';
  if (/^рязан/i.test(n)) return 'Рязань';
  if (/^твер/i.test(n)) return 'Тверь';
  if (/^тул/i.test(n)) return 'Тулу';
  if (/^нижн/i.test(n)) return /новгород/i.test(n) ? 'Нижний Новгород' : 'Нижний';
  if (/^сочи$/i.test(n)) return 'Сочи';
  if (/[ая]$/i.test(n)) return n.replace(/[ая]$/i, 'у');
  return n;
}

function fillPromptFromPersonaVars() {
  const sel = document.getElementById('persona-template');
  const ta = document.getElementById('account-prompt');
  const varsBox = document.getElementById('persona-vars');
  if (!sel || !ta) return;
  const opt = sel.selectedOptions[0];
  if (!opt || !opt.value) return;
  const raw = opt.dataset.template || '';
  if (!raw) return;
  const name = document.getElementById('persona-name')?.value?.trim() || 'Аня';
  const age = document.getElementById('persona-age')?.value?.trim() || '26';
  const fromCity = document.getElementById('persona-from')?.value?.trim() || 'Липецк';
  const toCity = document.getElementById('persona-to')?.value?.trim() || 'город';
  const lc = (s) => String(s).toLocaleLowerCase('ru-RU');
  const fromIn = cityInPrep(fromCity);
  const toIn = cityInPrep(toCity);
  const toAcc = cityInAcc(toCity);
  const map = {
    NAME: name,
    AGE: age,
    FROM_CITY: fromCity,
    TO_CITY: toCity,
    FROM_CITY_LC: lc(fromCity),
    TO_CITY_LC: lc(toCity),
    FROM_CITY_IN: fromIn,
    TO_CITY_IN: toIn,
    FROM_CITY_ACC: cityInAcc(fromCity),
    TO_CITY_ACC: toAcc,
    FROM_CITY_IN_LC: lc(fromIn),
    TO_CITY_IN_LC: lc(toIn),
    TO_CITY_ACC_LC: lc(toAcc),
  };
  ta.value = raw.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_, key) =>
    map[key] != null ? map[key] : '',
  );
  sel.dataset.lastTemplatePrompt = ta.value;
  if (varsBox) varsBox.hidden = false;
}

function setPersonaVarsVisible(show, defaults = {}) {
  const varsBox = document.getElementById('persona-vars');
  if (!varsBox) return;
  varsBox.hidden = !show;
  if (!show) return;
  const nameEl = document.getElementById('persona-name');
  const ageEl = document.getElementById('persona-age');
  const fromEl = document.getElementById('persona-from');
  const toEl = document.getElementById('persona-to');
  if (nameEl) nameEl.value = defaults.name || '';
  if (ageEl) ageEl.value = defaults.age || '';
  if (fromEl) fromEl.value = defaults.fromCity || '';
  if (toEl) toEl.value = defaults.toCity || '';
}

async function loadPersonaTemplates() {
  const sel = document.getElementById('persona-template');
  if (!sel || sel.dataset.loaded === '1') return;
  try {
    const data = await api.personaTemplates();
    const list = data.templates || [];
    for (const t of list) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.title;
      opt.dataset.prompt = t.prompt || '';
      opt.dataset.template = t.template || '';
      opt.dataset.defaults = JSON.stringify(t.defaults || {});
      sel.appendChild(opt);
    }
    sel.dataset.loaded = '1';
    sel.dataset.lastTemplatePrompt = '';
    sel.addEventListener('change', () => {
      const opt = sel.selectedOptions[0];
      const ta = document.getElementById('account-prompt');
      if (!ta) return;
      if (!opt || !opt.value) {
        ta.value = '';
        sel.dataset.lastTemplatePrompt = '';
        setPersonaVarsVisible(false);
        return;
      }
      let defaults = {};
      try {
        defaults = JSON.parse(opt.dataset.defaults || '{}');
      } catch (_) {
        defaults = {};
      }
      setPersonaVarsVisible(true, defaults);
      fillPromptFromPersonaVars();
    });
    for (const id of ['persona-name', 'persona-age', 'persona-from', 'persona-to']) {
      const el = document.getElementById(id);
      if (!el || el.dataset.bound === '1') continue;
      el.dataset.bound = '1';
      el.addEventListener('input', () => fillPromptFromPersonaVars());
    }
  } catch (e) {
    console.warn('persona templates:', e.message);
  }
}

async function startApp() {
  cacheInitDataIfAny();
  ensureAuthBanner();
  bindEvents();
  render();
  setBootStatus('Загружаем данные…');
  try {
  await loadAllData();
  await loadPersonaTemplates();
  } finally {
    setBootStatus('');
  }
  startBackgroundRefresh();
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

/**
 * Desktop WebView иногда отдаёт WebApp без initData на первом кадре —
 * ждём hash/WebApp.initData, иначе ложная заглушка «Откройте в Telegram».
 */
function waitForTelegramInitData(maxMs = 3000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      tg = getTg();
      if (tg) applyTelegramChrome(tg);
      if (resolveTelegramInitData()) {
        resolve(true);
        return;
      }
      if (Date.now() - started >= maxMs) {
        resolve(Boolean(resolveTelegramInitData()));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

let splashWatchdog = null;

function clearSplashWatchdog() {
  if (splashWatchdog) {
    clearTimeout(splashWatchdog);
    splashWatchdog = null;
  }
}

function hideAppSplash() {
  const splash = document.getElementById('app-splash');
  if (!splash) return;
  clearSplashWatchdog();
  splash.classList.add('is-done');
  splash.setAttribute('aria-busy', 'false');
  const shell = document.querySelector('.app-shell');
  if (shell) {
    shell.classList.add('is-ready');
  }
  if (state.activeTab) {
    setActiveTab(state.activeTab);
  } else {
    syncNavIndicator();
  }
  window.setTimeout(() => {
    splash.hidden = true;
    splash.classList.remove('is-done');
  }, 480);
}

function setBootStatus(text) {
  const splash = document.getElementById('app-splash');
  const legacy = document.getElementById('tg-boot-status');
  if (legacy) legacy.remove();

  if (!splash) return;

  if (!text) {
    hideAppSplash();
    return;
  }

  splash.hidden = false;
  splash.classList.remove('is-done');
  splash.setAttribute('aria-busy', 'true');
  const status = document.getElementById('app-splash-status');
  if (status) status.textContent = text;
  clearSplashWatchdog();
  // Анти-hang: splash не может висеть вечно даже если loadAllData завис.
  splashWatchdog = window.setTimeout(() => {
    hideAppSplash();
  }, 12000);
}

async function initializeApp() {
  watchMobileKeyboard();
  setBootStatus('Загрузка…');

  // Сразу прячем заглушку, если похоже на Telegram — иначе Desktop мигает
  // «Откройте в Telegram» из‑за пустого initData / кэша старого JS.
  const gateEl = document.getElementById('tg-gate');
  if (isTelegramShell() && gateEl) gateEl.hidden = true;

  try {
  if (isTelegramWebApp()) {
      await startApp();
      return;
    }

    if (isTelegramShell()) {
      const ok = await waitForTelegramInitData(4000);
      console.log('Telegram initData after wait:', ok, 'platform:', getTg()?.platform);
      await startApp();
      return;
    }

    // Ещё раз подождём — CDN telegram-web-app.js мог подгрузиться позже.
    const late = await waitForTelegramInitData(1500);
    if (late || isTelegramShell()) {
      await startApp();
      return;
    }

    setBootStatus('');
    showTelegramGate();
  } catch (err) {
    console.error('initializeApp failed:', err);
    setBootStatus('Не удалось загрузить кабинет. Закрой Mini App и открой снова из бота.');
  } finally {
    const gate = document.getElementById('tg-gate');
    const shell = document.querySelector('.app-shell');
    const gateVisible = gate && !gate.hidden;
    const shellHidden = shell && shell.style.display === 'none';
    if (!gateVisible && !shellHidden) hideAppSplash();
  }
}

window.addEventListener('resize', () => {
  window.requestAnimationFrame(syncNavIndicator);
});
window.addEventListener('orientationchange', () => {
  window.setTimeout(syncNavIndicator, 120);
});

initializeApp();
