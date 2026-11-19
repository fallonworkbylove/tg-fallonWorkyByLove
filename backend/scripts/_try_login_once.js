#!/usr/bin/env node
/**
 * One-shot: startLogin for a phone, print Telegram delivery type.
 * Usage: node _try_login_once.js +79244855206
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const phone = process.argv[2] || '+79244855206';
const userId = process.argv[3] || 'agent-try-' + Date.now();

(async () => {
  const tg = require('../services/telegramClient');
  console.log('api_id', process.env.TELEGRAM_API_ID);
  console.log('phone', phone, 'userId', userId);
  try {
    const result = await tg.startLogin(userId, phone);
    console.log('OK', JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('FAIL', err.errorMessage || err.message);
    if (err.seconds) console.error('flood_seconds', err.seconds);
    process.exit(1);
  }
})();
