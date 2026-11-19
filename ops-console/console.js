#!/usr/bin/env node
/**
 * LoveRussian ops console — terminal dashboard for Windows & macOS.
 * Outside Telegram / Mini App. Needs Node 18+ and ADMIN_CONSOLE_TOKEN.
 *
 *   copy config.example.json → config.json  (token + baseUrl)
 *   npm start
 *
 * Env overrides: LR_OPS_URL, LR_OPS_TOKEN, LR_OPS_REFRESH
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');
const ONCE = process.argv.includes('--once');

function loadConfig() {
  let file = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (err) {
      die(`Не разобрать config.json: ${err.message}`);
    }
  }
  const baseUrl = String(
    process.env.LR_OPS_URL || file.baseUrl || 'https://loverussian.duckdns.org',
  )
    .trim()
    .replace(/\/+$/, '');
  if (!/^https:\/\//i.test(baseUrl)) {
    die('Адрес кабинета должен быть https:// (не http)');
  }
  const allowed = new Set(
    String(process.env.LR_OPS_ALLOWED_HOSTS || 'loverussian.duckdns.org')
      .split(/[,;\s]+/)
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
  let host;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    die('Некорректный baseUrl');
  }
  if (!allowed.has(host)) {
    die(`Хост не в allowlist: ${host}`);
  }
  const token = String(process.env.LR_OPS_TOKEN || file.token || '').trim();
  const refreshSec = Math.max(
    5,
    Number(process.env.LR_OPS_REFRESH || file.refreshSec || 20) || 20,
  );
  if (!token || token.length < 16 || token.includes('PASTE_')) {
    die(
      'Нет токена.\n' +
        '1) Скопируй config.example.json → config.json\n' +
        '2) Вставь token с сервера (ADMIN_CONSOLE_TOKEN)\n' +
        '   или задай LR_OPS_TOKEN',
    );
  }
  return { baseUrl, token, refreshSec };
}

function die(msg) {
  process.stderr.write(`\n[ops-console] ${msg}\n\n`);
  process.exit(1);
}

function n(v) {
  return Number(v || 0).toLocaleString('ru-RU');
}

function pad(s, w) {
  const str = String(s ?? '');
  if (str.length >= w) return str.slice(0, w);
  return str + ' '.repeat(w - str.length);
}

function padL(s, w) {
  const str = String(s ?? '');
  if (str.length >= w) return str.slice(0, w);
  return ' '.repeat(w - str.length) + str;
}

async function fetchSnapshot(cfg) {
  const url = `${cfg.baseUrl}/api/admin/console`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Admin-Console-Token': cfg.token,
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 180)}`);
  }
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data.console || data;
}

function clearScreen() {
  if (process.stdout.isTTY) {
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
  }
}

function render(snap, cfg, err) {
  const now = new Date().toLocaleString('ru-RU', { hour12: false });
  const lines = [];
  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║  LoveRussian · OPS CONSOLE                    Win / macOS  ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push(`  ${now}   refresh ${cfg.refreshSec}s   МСК сутки 00:00`);
  lines.push(`  ${cfg.baseUrl}`);
  lines.push('');

  if (err) {
    lines.push(`  ОШИБКА: ${err}`);
    lines.push('');
    lines.push('  Проверь token / сеть. Ctrl+C — выход.');
    return `${lines.join('\n')}\n`;
  }

  const m = snap.messages || {};
  const day = m.day || {};
  const week = m.week || {};
  const month = m.month || {};
  const acc = snap.accounts || {};
  const list = Array.isArray(acc.list) ? acc.list : [];

  lines.push('  ┌────────────┬────────────┬────────────┐');
  lines.push('  │   ДЕНЬ     │   НЕДЕЛЯ   │   МЕСЯЦ    │');
  lines.push('  ├────────────┼────────────┼────────────┤');
  lines.push(
    `  │ ${padL(n(day.sent), 10)} │ ${padL(n(week.sent), 10)} │ ${padL(n(month.sent), 10)} │  отправлено`,
  );
  lines.push(
    `  │ ${padL(n(day.incoming), 10)} │ ${padL(n(week.incoming), 10)} │ ${padL(n(month.incoming), 10)} │  входящие`,
  );
  lines.push('  └────────────┴────────────┴────────────┘');
  lines.push('');
  lines.push(
    `  Аккаунтов: ${n(acc.total)}   онлайн: ${n(acc.online)}   AI: ${n(acc.aiOn)}   горячих: ${n(snap.hotLeads)}`,
  );
  lines.push('');
  lines.push('  Аккаунты (сегодня / 7 дней)');
  lines.push('  ' + '─'.repeat(58));
  lines.push(
    `  ${pad('имя / телефон', 28)} ${padL('день', 8)} ${padL('нед', 8)}  статус`,
  );
  lines.push('  ' + '─'.repeat(58));

  const top = list.slice(0, 24);
  if (!top.length) {
    lines.push('  (пусто)');
  } else {
    for (const a of top) {
      const title = a.name || a.phone || `#${a.id}`;
      const st = `${a.online ? 'онлайн' : 'офф'} · ${a.ai ? 'AI' : '—'}`;
      lines.push(
        `  ${pad(title, 28)} ${padL(n(a.sentToday), 8)} ${padL(n(a.sentWeek), 8)}  ${st}`,
      );
    }
  }

  lines.push('');
  lines.push('  R — обновить сейчас · Ctrl+C — выход');
  return `${lines.join('\n')}\n`;
}

async function tick(cfg) {
  try {
    const snap = await fetchSnapshot(cfg);
    clearScreen();
    process.stdout.write(render(snap, cfg, null));
  } catch (err) {
    clearScreen();
    process.stdout.write(render(null, cfg, err.message || String(err)));
  }
}

async function main() {
  const cfg = loadConfig();

  if (ONCE) {
    const snap = await fetchSnapshot(cfg);
    process.stdout.write(render(snap, cfg, null));
    return;
  }

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (key) => {
      if (key === '\u0003') process.exit(0); // Ctrl+C
      if (key === 'r' || key === 'R' || key === '\r' || key === '\n') {
        tick(cfg).catch(() => {});
      }
      if (key === 'q' || key === 'Q') process.exit(0);
    });
  }

  await tick(cfg);
  setInterval(() => {
    tick(cfg).catch(() => {});
  }, cfg.refreshSec * 1000);
}

main().catch((err) => die(err.message || String(err)));
