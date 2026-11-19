#!/usr/bin/env node
'use strict';
/**
 * Дожимает offline-сессии после AUTH_KEY_DUPLICATED.
 * Запускать на VPS из backend/: node scripts/_heal_offline_0iw.js
 */
const fs = require('fs');
const path = require('path');

(async () => {
  const envPath = path.join(__dirname, '../.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }

  // Важно: heal в том же процессе что pm2 нельзя — отдельный process = dual GramJS!
  // Поэтому только через HTTP loopback API, если есть, иначе exit.
  const http = require('http');
  const key = process.env.AUTH_BYPASS_KEY || process.env.TELEGRAM_AUTH_BYPASS_KEY || '';

  function get(urlPath) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: Number(process.env.PORT) || 3000,
          path: urlPath,
          headers: key ? { 'X-Auth-Bypass-Key': key } : {},
        },
        (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, body: JSON.parse(b || '{}') });
            } catch (_) {
              resolve({ status: res.statusCode, body: b });
            }
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  const health = await get('/api/health');
  console.log('health', health.body);

  // pool-status если есть
  let pool;
  try {
    pool = await get('/api/accounts/pool-status');
    console.log('pool', JSON.stringify(pool.body).slice(0, 500));
  } catch (e) {
    console.log('pool_fail', e.message);
  }

  console.log(
    'HEAL_NOTE: не поднимай второй GramJS. Если online < total — pm2 stop; sleep 180; pm2 start',
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
