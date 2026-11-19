/**
 * Кольцевой буфер логов для OPS desktop (админ-консоль).
 * Секреты редактируются до записи в буфер.
 */

const MAX = Math.max(200, Math.min(5000, Number(process.env.ADMIN_LOG_BUFFER || 1200) || 1200));
const lines = [];
let installed = false;
let seq = 0;

const REDACT = [
  /\bsk-(?:proj|test|live|svcacct)-[A-Za-z0-9_\-]{8,}/gi,
  /\bsk-[A-Za-z0-9]{20,}/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\bADMIN_CONSOLE_TOKEN[=:]\s*\S+/gi,
  /\bLR_OPS_TOKEN[=:]\s*\S+/gi,
  /\bBOT_TOKEN[=:]\s*\S+/gi,
  /\bOPENAI_API_KEY[=:]\s*\S+/gi,
  /\bsession_string[=:]\s*\S+/gi,
  /\b1[A-Za-z0-9+/_-]{80,}={0,2}\b/g,
  /socks5:\/\/[^:\s]+:[^@\s]+@/gi,
  /:(?:socks5|socks):[^:\s]+:\d+:([^:\s]+):([^\s;]+)/gi,
  /tg:\/\/login\?token=[^\s"'<>]+/gi,
  /api\.qrserver\.com\/[^\s"'<>]+/gi,
  /\braw=\\?"?\d{4,8}\\?"?/gi,
  /\bextracted=\d{4,8}\b/gi,
  /\bphoneCode[=:]\s*\d{4,8}\b/gi,
];

function redactText(raw) {
  let text = String(raw || '');
  for (const re of REDACT) {
    text = text.replace(re, (m) => {
      if (/socks5:\/\//i.test(m)) return 'socks5://***:***@';
      if (m.includes('=')) return `${m.split(/[=:]/)[0]}=***`;
      if (m.startsWith('Bearer')) return 'Bearer ***';
      if (m.startsWith('sk-')) return 'sk-***';
      return '***';
    });
  }
  // user:pass in socks5 host:port:user:pass
  text = text.replace(
    /(socks5\s+\d+\.\d+\.\d+\.\d+:\d+):\S+:\S+/gi,
    '$1:***:***',
  );
  return text;
}

function push(level, args) {
  let text;
  try {
    text = args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.stack || a.message;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');
  } catch {
    text = String(args?.[0] ?? '');
  }
  text = redactText(text);
  if (text.length > 4000) text = `${text.slice(0, 4000)}…`;
  seq += 1;
  lines.push({
    id: seq,
    ts: new Date().toISOString(),
    level,
    text,
  });
  while (lines.length > MAX) lines.shift();
}

function install() {
  if (installed) return;
  installed = true;
  const wrap = (level, orig) =>
    function adminLogWrapped(...args) {
      try {
        push(level, args);
      } catch (_) {}
      return orig.apply(console, args);
    };
  console.log = wrap('info', console.log.bind(console));
  console.warn = wrap('warn', console.warn.bind(console));
  console.error = wrap('error', console.error.bind(console));
  push('info', ['[admin-log] buffer on (redacted)']);
}

function getLogs({ limit = 300, afterId = 0 } = {}) {
  const lim = Math.max(1, Math.min(2000, Number(limit) || 300));
  const after = Math.max(0, Number(afterId) || 0);
  const filtered = after > 0 ? lines.filter((l) => l.id > after) : lines;
  const slice = filtered.slice(-lim);
  return {
    lines: slice,
    total: lines.length,
    latestId: lines.length ? lines[lines.length - 1].id : 0,
  };
}

function clearLogs() {
  lines.length = 0;
  push('info', ['[admin-log] cleared']);
  return getLogs({ limit: 20 });
}

module.exports = { install, getLogs, clearLogs, push, redactText };
