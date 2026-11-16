/**
 * C3: лимит попыток логина/QR на userId и телефон (после auth).
 * HTTP IP-кап — в middleware/httpRateLimit.
 */
'use strict';

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

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.start > 15 * 60_000) buckets.delete(k);
  }
}, 60_000).unref?.();

/**
 * @returns {{ ok: true } | { ok: false, error: string, status: number }}
 */
function allowLoginAttempt({ userId, phone } = {}) {
  const uid = userId != null && userId !== '' ? String(userId) : '';
  const ph = String(phone || '').replace(/\D/g, '');
  if (uid && !take(`u:${uid}`, 8, 10 * 60_000)) {
    return { ok: false, error: 'Слишком много попыток входа', status: 429 };
  }
  if (ph && !take(`p:${ph}`, 5, 10 * 60_000)) {
    return { ok: false, error: 'Слишком много попыток для этого номера', status: 429 };
  }
  return { ok: true };
}

module.exports = { allowLoginAttempt, take };
