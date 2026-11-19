/**
 * Browser / WebView bridge — same window.ops API as Electron preload.
 * Only installs when preload did not expose window.ops.
 */
(function () {
  if (window.ops) return;

  const STORAGE_KEY = 'lr_ops_web_v1';
  /** API host (never the OPS static origin — keep token storage off miniapp origin). */
  const DEFAULT_BASE = 'https://loverussian.duckdns.org';
  const OPS_ORIGIN_HOSTS = ['ops-loverussian.duckdns.org'];
  const FETCH_TIMEOUT_MS = 45000;

  const API_ALLOW = [
    { method: 'GET', re: /^\/?$/ },
    { method: 'GET', re: /^\/blacklist$/ },
    { method: 'POST', re: /^\/blacklist$/ },
    { method: 'DELETE', re: /^\/blacklist\/\d+$/ },
    { method: 'POST', re: /^\/accounts$/ },
    { method: 'DELETE', re: /^\/accounts\/\d+$/ },
    { method: 'POST', re: /^\/accounts\/\d+\/start-ai$/ },
    { method: 'POST', re: /^\/accounts\/\d+\/stop-ai$/ },
    { method: 'POST', re: /^\/accounts\/bulk\/start-ai$/ },
    { method: 'POST', re: /^\/accounts\/bulk\/stop-ai$/ },
    { method: 'GET', re: /^\/accounts\/\d+\/ping$/ },
    { method: 'POST', re: /^\/accounts\/connect\/(start|resend|code|password)$/ },
    { method: 'GET', re: /^\/proxies$/ },
    { method: 'POST', re: /^\/proxies\/check$/ },
    { method: 'GET', re: /^\/logs(\?.*)?$/ },
    { method: 'DELETE', re: /^\/logs$/ },
    { method: 'GET', re: /^\/activity(\?.*)?$/ },
  ];

  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function saveStore(partial) {
    const next = { ...loadStore(), ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  function tokenLooksValid(token) {
    const t = String(token || '').trim();
    return Boolean(t && t.length >= 16 && !t.includes('PASTE_') && !/^•+$/.test(t));
  }

  /** APK: mark platform only — token must be entered in Settings (never baked). */
  function bootstrapFromAndroid() {
    try {
      if (!window.AndroidOps) return false;
      document.documentElement.classList.add('ops-apk');
      document.body?.classList.add('ops-apk');
      // Prefer API base from native; never pull a baked token.
      try {
        const nativeBase = String(AndroidOps.getBaseUrl?.() || '').trim();
        if (/^https:\/\//i.test(nativeBase)) {
          const bu = nativeBase.replace(/\/+$/, '');
          if (bu !== DEFAULT_BASE) saveStore({ baseUrl: bu });
          else saveStore({ baseUrl: DEFAULT_BASE });
        }
      } catch (_) {}
      return true;
    } catch (_) {
      return false;
    }
  }

  bootstrapFromAndroid();

  function baseUrl() {
    const store = loadStore();
    if (store.baseUrl && /^https:\/\//i.test(store.baseUrl)) {
      const bu = String(store.baseUrl).replace(/\/+$/, '');
      // OPS static origin must not be used as API base
      try {
        const host = new URL(bu).hostname.toLowerCase();
        if (OPS_ORIGIN_HOSTS.includes(host)) return DEFAULT_BASE;
      } catch (_) {}
      return bu;
    }
    if (typeof location !== 'undefined' && /^https:\/\//i.test(location.origin)) {
      try {
        const host = location.hostname.toLowerCase();
        if (OPS_ORIGIN_HOSTS.includes(host)) return DEFAULT_BASE;
      } catch (_) {}
      // Legacy /ops/ on main host — API is same origin
      return location.origin.replace(/\/+$/, '');
    }
    return DEFAULT_BASE;
  }

  function assertAllowed(method, pathSuffix) {
    const m = String(method || 'GET').toUpperCase();
    const p = String(pathSuffix || '');
    if (p.includes('..') || p.includes('://') || p.startsWith('//')) {
      throw new Error('Недопустимый путь API');
    }
    const ok = API_ALLOW.some((rule) => rule.method === m && rule.re.test(p));
    if (!ok) throw new Error(`API не разрешён: ${m} ${p}`);
  }

  async function api(method, pathSuffix, body) {
    const store = loadStore();
    if (!tokenLooksValid(store.token)) {
      throw new Error('Нет ключа — сохрани доступ в Настройках');
    }
    assertAllowed(method, pathSuffix);
    const url = `${baseUrl()}/api/admin/console${pathSuffix || ''}`;
    const headers = {
      Accept: 'application/json',
      'X-Admin-Console-Token': store.token,
    };
    const init = { method: method || 'GET', headers };
    if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    init.signal = ac.signal;
    try {
      const res = await fetch(url, init);
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
      }
      if (!res.ok || data.success === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return data;
    } catch (err) {
      if (err?.name === 'AbortError') throw new Error('Таймаут запроса к серверу');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  document.documentElement.classList.add('ops-web');
  document.body?.classList.add('ops-web', 'platform-web');
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.classList.add('ops-web', 'platform-web');
    });
  }

  window.ops = {
    getConfig: async () => {
      const store = loadStore();
      const hasToken = tokenLooksValid(store.token);
      return {
        baseUrl: baseUrl(),
        refreshSec: Math.max(8, Number(store.refreshSec) || 25),
        cfgPath: 'localStorage',
        hasToken,
        tokenHint: hasToken ? `…${String(store.token).slice(-4)}` : '',
      };
    },
    saveConfig: async (incoming = {}) => {
      const current = loadStore();
      let token = String(incoming.token || '').trim();
      if (!tokenLooksValid(token) && tokenLooksValid(current.token)) {
        token = current.token;
      }
      if (!tokenLooksValid(token)) {
        throw new Error('Ключ слишком короткий');
      }
      const refreshSec = Math.max(
        8,
        Math.min(120, Number(incoming.refreshSec) || current.refreshSec || 25),
      );
      const next = saveStore({
        token,
        refreshSec,
        baseUrl: baseUrl(),
      });
      return {
        baseUrl: next.baseUrl || baseUrl(),
        refreshSec: next.refreshSec,
        hasToken: true,
        tokenHint: `…${token.slice(-4)}`,
      };
    },
    fetchConsole: async () => {
      const data = await api('GET', '/');
      return data.console;
    },
    fetchUpdates: async () => {
      if (Array.isArray(window.LOVERUSSIAN_UPDATES)) {
        return window.LOVERUSSIAN_UPDATES;
      }
      return [];
    },
    api: (method, path, body) => api(method, path, body),
    setThemeChrome: async () => true,
  };
})();
