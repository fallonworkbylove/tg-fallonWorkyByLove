/**
 * In-memory HTTP rate limits (per socket IP).
 * Global soft cap + stricter buckets for connect/login and admin console.
 */
'use strict';

function socketIp(req) {
  const raw = String(
    req.socket?.remoteAddress || req.connection?.remoteAddress || '',
  );
  if (raw === '::1' || raw.endsWith('127.0.0.1')) return 'loopback';
  return raw || String(req.ip || 'unknown');
}

/** @type {Map<string, { start: number, n: number }>} */
const buckets = new Map();

function take(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    b = { start: now, n: 0 };
    buckets.set(key, b);
  }
  b.n += 1;
  return b.n <= limit;
}

// Редко чистим, чтобы Map не рос бесконечно.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.start > 5 * 60_000) buckets.delete(k);
  }
}, 60_000).unref?.();

function httpRateLimit(req, res, next) {
  if (req.path === '/api/health') return next();
  const ip = socketIp(req);
  // Loopback (nginx→node, ops scripts) — без глобального капа.
  if (ip === 'loopback') return next();

  if (!take(`g:${ip}`, 240, 60_000)) {
    return res.status(429).json({ error: 'Слишком много запросов' });
  }

  const p = req.path || '';
  // C3: connect/QR жёстче (миниапп + admin console).
  const isConnect =
    p.includes('/accounts/connect') ||
    p.includes('/accounts/qr') ||
    /\/connect\/(start|code|password|resend)/.test(p);
  if (isConnect && !take(`c:${ip}`, 12, 60_000)) {
    return res.status(429).json({ error: 'Слишком много попыток входа' });
  }

  if (
    (p === '/api/admin/console' || p.startsWith('/api/admin/console/')) &&
    !take(`a:${ip}`, 90, 60_000)
  ) {
    return res.status(429).json({ error: 'Слишком много запросов' });
  }

  return next();
}

module.exports = httpRateLimit;
module.exports.take = take;
module.exports.socketIp = socketIp;
