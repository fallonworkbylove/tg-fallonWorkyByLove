#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

(async () => {
  const envPath = path.join(__dirname, '../.env');
  const t = fs.readFileSync(envPath, 'utf8');
  const tok = (t.match(/^BOT_TOKEN=(.*)$/m) || [])[1].trim();
  console.log('token_len', tok.length);
  const t0 = Date.now();
  try {
    const r = await fetch(`https://api.telegram.org/bot${tok}/getMe`);
    console.log('getMe', r.status, Date.now() - t0, (await r.text()).slice(0, 180));
  } catch (e) {
    console.log('getMe_fail', Date.now() - t0, e.cause || e.message || e);
  }
  try {
    const r2 = await fetch(
      `https://api.telegram.org/bot${tok}/getUpdates?timeout=1&limit=3&allowed_updates=${encodeURIComponent(JSON.stringify(['message', 'callback_query']))}`,
    );
    const body = await r2.text();
    console.log('getUpdates', r2.status, Date.now() - t0, body.slice(0, 500));
  } catch (e) {
    console.log('upd_fail', Date.now() - t0, e.cause || e.message || e);
  }
  try {
    const r3 = await fetch(`https://api.telegram.org/bot${tok}/getWebhookInfo`);
    console.log('webhook', await r3.text());
  } catch (e) {
    console.log('wh_fail', e.message);
  }
})();
