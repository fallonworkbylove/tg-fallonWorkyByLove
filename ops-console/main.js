/**
 * LoveRussian OPS — Electron shell (Windows / macOS).
 */
const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { chromeFor, overlayOptions, overlayOptionsMac, OVERLAY_HEIGHT } = require('./themeChrome');

const FETCH_TIMEOUT_MS = 45000;
const DEFAULT_BASE_URL = 'https://loverussian.duckdns.org';
/** Только эти хосты — иначе токен уедет на чужой URL. Env: LR_OPS_ALLOWED_HOSTS=a.com,b.com */
const ALLOWED_BASE_HOSTS = new Set(
  String(process.env.LR_OPS_ALLOWED_HOSTS || 'loverussian.duckdns.org')
    .split(/[,;\s]+/)
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

/** Простой антиспам IPC: не чаще N вызовов / окно. */
const IPC_RATE = new Map();
function rateOk(key, max = 40, windowMs = 10000) {
  const now = Date.now();
  let bucket = IPC_RATE.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, n: 0 };
    IPC_RATE.set(key, bucket);
  }
  bucket.n += 1;
  return bucket.n <= max;
}

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

function configCandidates() {
  const list = [];
  if (process.env.LR_OPS_CONFIG) list.push(process.env.LR_OPS_CONFIG);
  try {
    list.push(path.join(app.getPath('userData'), 'config.json'));
  } catch (_) {}
  // Рядом с .exe / .app (удобно для переноса)
  try {
    if (app.isPackaged) {
      list.push(path.join(path.dirname(process.execPath), 'config.json'));
      if (process.platform === 'darwin') {
        list.push(path.join(process.resourcesPath, 'config.json'));
      }
    }
  } catch (_) {}
  list.push(path.join(__dirname, 'config.json'));
  return list;
}

function resolveConfigPath() {
  for (const p of configCandidates()) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {}
  }
  try {
    return path.join(app.getPath('userData'), 'config.json');
  } catch (_) {
    return path.join(__dirname, 'config.json');
  }
}

function loadConfig() {
  const cfgPath = resolveConfigPath();
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (_) {}
  const baseUrl = String(process.env.LR_OPS_URL || file.baseUrl || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, '');
  return {
    cfgPath,
    baseUrl: baseUrl || DEFAULT_BASE_URL,
    token: String(process.env.LR_OPS_TOKEN || file.token || '').trim(),
    refreshSec: Math.max(8, Number(process.env.LR_OPS_REFRESH || file.refreshSec || 25) || 25),
  };
}

function tokenLooksValid(token) {
  const t = String(token || '').trim();
  return Boolean(t && t.length >= 16 && !t.includes('PASTE_') && !/^•+$/.test(t));
}

function assertAllowedBaseUrl(raw) {
  const base = String(raw || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base)) {
    throw new Error('Адрес кабинета должен быть https://');
  }
  let host;
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    throw new Error('Некорректный адрес кабинета');
  }
  if (!ALLOWED_BASE_HOSTS.has(host)) {
    throw new Error(`Хост не в allowlist: ${host}`);
  }
  return base;
}

function requireToken(cfg) {
  if (!tokenLooksValid(cfg.token)) {
    throw new Error('Нет ключа — сохрани доступ в Настройках');
  }
  assertAllowedBaseUrl(cfg.baseUrl);
}

/**
 * Безопасный разбор updates.js: JS object-literal → JSON, без vm/eval.
 */
function extractBalancedArray(text, fromIdx) {
  const start = text.indexOf('[', fromIdx);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let quote = '';
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function jsLiteralToJson(src) {
  let out = '';
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    // /* block */
    if (s[i] === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + 2;
      continue;
    }
    // // line
    if (s[i] === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i += 1;
      continue;
    }
    if (s[i] === "'" || s[i] === '"') {
      const q = s[i];
      let str = '"';
      i += 1;
      while (i < s.length) {
        const c = s[i];
        if (c === '\\') {
          const n = s[i + 1];
          if (n === "'" && q === "'") {
            str += "'";
            i += 2;
            continue;
          }
          if (n === '"') {
            str += '\\"';
            i += 2;
            continue;
          }
          str += c + (n || '');
          i += 2;
          continue;
        }
        if (c === q) {
          i += 1;
          break;
        }
        if (c === '"') str += '\\"';
        else if (c === '\n') str += '\\n';
        else if (c === '\r') {
          i += 1;
          continue;
        } else str += c;
        i += 1;
      }
      out += `${str}"`;
      continue;
    }
    out += s[i];
    i += 1;
  }
  out = out.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
  out = out.replace(/,\s*([}\]])/g, '$1');
  return out;
}

function parseUpdatesList(jsText) {
  const text = String(jsText || '');
  const marker = text.match(
    /(?:window\.)?(?:LOVERUSSIAN_UPDATES|OPS_UPDATES)\s*=\s*/,
  );
  if (!marker) throw new Error('Лента: нет маркера обновлений');
  const raw = extractBalancedArray(text, marker.index + marker[0].length - 1);
  if (!raw) throw new Error('Лента: массив не найден');
  let list;
  try {
    list = JSON.parse(jsLiteralToJson(raw));
  } catch (err) {
    throw new Error(`Лента: JSON (${err.message})`);
  }
  if (!Array.isArray(list) || !list.length) throw new Error('Лента пуста');
  // Санитизация полей — только plain data.
  return list.map((item) => ({
    date: String(item?.date || '').slice(0, 64),
    tag: String(item?.tag || '').slice(0, 32),
    title: String(item?.title || '').slice(0, 200),
    lead: String(item?.lead || '').slice(0, 800),
    items: Array.isArray(item?.items)
      ? item.items.map((x) => String(x || '').slice(0, 400)).slice(0, 20)
      : [],
  }));
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
  const cfg = loadConfig();
  requireToken(cfg);
  assertAllowed(method, pathSuffix);
  const url = `${cfg.baseUrl}/api/admin/console${pathSuffix || ''}`;
  const headers = {
    Accept: 'application/json',
    'X-Admin-Console-Token': cfg.token,
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

function applyWindowChrome(win, themeId) {
  if (!win || win.isDestroyed()) return;
  const chrome = chromeFor(themeId);
  try {
    win.setBackgroundColor(chrome.backgroundColor);
  } catch (_) {}
  try {
    nativeTheme.themeSource = chrome.scheme === 'light' ? 'light' : 'dark';
  } catch (_) {}
  if (typeof win.setTitleBarOverlay !== 'function') return;
  try {
    if (process.platform === 'darwin') {
      win.setTitleBarOverlay(overlayOptionsMac());
    } else {
      win.setTitleBarOverlay(overlayOptions(themeId));
    }
  } catch (_) {}
  if (process.platform === 'darwin') {
    try {
      // Светофоры по центру цветной полоски (~36px)
      win.setWindowButtonPosition?.({ x: 16, y: Math.max(8, Math.round((OVERLAY_HEIGHT - 12) / 2)) });
    } catch (_) {}
  }
}

function createWindow() {
  const initialTheme = 'rose';
  const chrome = chromeFor(initialTheme);
  try {
    nativeTheme.themeSource = chrome.scheme === 'light' ? 'light' : 'dark';
  } catch (_) {}

  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: 'LoveRussian OPS',
    backgroundColor: chrome.backgroundColor,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    // Win/Linux: цвет полоски + иконок. Mac: высота overlay + фон приложения.
    titleBarOverlay: isMac ? overlayOptionsMac() : overlayOptions(initialTheme),
    ...(isMac
      ? {
          trafficLightPosition: {
            x: 16,
            y: Math.max(8, Math.round((OVERLAY_HEIGHT - 12) / 2)),
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'app', 'index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:') shell.openExternal(url);
    } catch (_) {}
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    const allowed = url.startsWith('file://');
    if (!allowed) e.preventDefault();
  });

  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
}

ipcMain.handle('ops:get-config', () => {
  const cfg = loadConfig();
  const hasToken = tokenLooksValid(cfg.token);
  return {
    baseUrl: cfg.baseUrl || DEFAULT_BASE_URL,
    refreshSec: cfg.refreshSec,
    cfgPath: cfg.cfgPath,
    hasToken,
    // Токен в renderer не отдаём — только хвост для подсказки.
    tokenHint: hasToken ? `…${cfg.token.slice(-4)}` : '',
  };
});

ipcMain.handle('ops:save-config', (_evt, incoming = {}) => {
  if (!rateOk('save-config', 8, 15000)) {
    throw new Error('Слишком часто — подожди секунду');
  }
  const current = loadConfig();
  const baseUrl = assertAllowedBaseUrl(
    incoming.baseUrl || current.baseUrl || DEFAULT_BASE_URL,
  );
  let token = String(incoming.token || '').trim();
  // Пустое / маска «••••» — оставляем прежний ключ
  if (!tokenLooksValid(token) && tokenLooksValid(current.token)) {
    token = current.token;
  }
  const refreshSec = Math.max(8, Math.min(120, Number(incoming.refreshSec) || current.refreshSec || 25));
  if (!tokenLooksValid(token)) {
    throw new Error('Ключ слишком короткий');
  }
  let target;
  try {
    target = path.join(app.getPath('userData'), 'config.json');
  } catch (_) {
    target = path.join(__dirname, 'config.json');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.chmodSync(path.dirname(target), 0o700);
  } catch (_) {}
  fs.writeFileSync(
    target,
    `${JSON.stringify({ baseUrl, token, refreshSec }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  return { ok: true, cfgPath: target, hasToken: true, tokenHint: `…${token.slice(-4)}` };
});

ipcMain.handle('ops:fetch-console', async () => {
  if (!rateOk('fetch-console', 30, 15000)) {
    throw new Error('Слишком частые запросы');
  }
  const data = await api('GET', '');
  return data.console || data;
});

/** Лента как в миниаппе — JSON-разбор, без vm/eval. */
ipcMain.handle('ops:fetch-updates', async () => {
  if (!rateOk('fetch-updates', 12, 30000)) {
    throw new Error('Слишком частые запросы');
  }
  const cfg = loadConfig();
  const base = assertAllowedBaseUrl(cfg.baseUrl || DEFAULT_BASE_URL);
  const url = `${base}/updates.js?v=${Date.now()}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  let text;
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: ac.signal,
      headers: { Accept: 'application/javascript,text/plain,*/*' },
    });
    if (!res.ok) throw new Error(`Лента: HTTP ${res.status}`);
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }
  return parseUpdatesList(text).slice(0, 200);
});

ipcMain.handle('ops:api', async (_evt, { method, path: p, body } = {}) => {
  if (!rateOk(`api:${method}:${String(p || '').split('?')[0]}`, 60, 15000)) {
    throw new Error('Слишком частые запросы');
  }
  return api(method || 'GET', p || '', body);
});

ipcMain.handle('ops:set-theme-chrome', (evt, themeId) => {
  const id = String(themeId || 'rose').replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
  const win = BrowserWindow.fromWebContents(evt.sender);
  applyWindowChrome(win, id || 'rose');
  return { ok: true };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
