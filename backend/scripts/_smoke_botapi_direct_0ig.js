#!/usr/bin/env node
/** Smoke 0ig: Bot API без авто-SOCKS из PROXY_LIST. */
const fs = require('fs');
const path = require('path');

function assert(c, m) {
  if (!c) {
    console.error('FAIL', m);
    process.exit(1);
  }
  console.log('OK', m);
}

const src = fs.readFileSync(
  path.join(__dirname, '../services/helpRequestNotifier.js'),
  'utf8',
);
assert(/BOT_API_PROXY/.test(src), 'BOT_API_PROXY supported');
assert(!/firstSocks5FromEnv/.test(src), 'no firstSocks5FromEnv for Bot API');
assert(/Work\/OpenAI PROXY_LIST сюда не тащим|только явный BOT_API_PROXY/.test(src), 'direct-by-default note');

console.log('SMOKE_BOTAPI_DIRECT_0IG_OK');
