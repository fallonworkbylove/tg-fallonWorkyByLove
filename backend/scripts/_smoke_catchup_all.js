#!/usr/bin/env node
require('dotenv').config();
const key = String(process.env.TELEGRAM_AUTH_BYPASS_KEY || '').trim();
if (!key) {
  console.error('no TELEGRAM_AUTH_BYPASS_KEY');
  process.exit(1);
}

(async () => {
  const r = await fetch('http://127.0.0.1:3000/api/accounts/catch-up-all', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'X-Auth-Bypass-Key': key,
    },
  });
  const text = await r.text();
  console.log('status', r.status);
  console.log(text);
  if (!r.ok) process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
