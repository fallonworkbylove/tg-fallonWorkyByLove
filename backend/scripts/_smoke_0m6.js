#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

const inbound = fs.readFileSync(path.join(__dirname, '../services/inbound.js'), 'utf8');
check('downloadMediaWithRetry helper', /async function downloadMediaWithRetry/.test(inbound));
check('voice uses helper', /downloadMediaWithRetry\([\s\S]*?voiceLabel/.test(inbound));
check('photo uses helper', /downloadMediaWithRetry\([\s\S]*?фото/.test(inbound));
check('video uses helper', /downloadMediaWithRetry\([\s\S]*?\$\{label\}/.test(inbound) || /downloadMediaWithRetry\([\s\S]*?label/.test(inbound));
check('sticker uses helper', /downloadMediaWithRetry\([\s\S]*?стикер/.test(inbound));

const hh = require('../services/humanHardening');
const hist = [
  { role: 'assistant', content: 'прикольно)' },
  { role: 'assistant', content: 'норм)' },
  { role: 'user', content: 'ага' },
];
const out = hh.stripRepeatPonialaHah('прикольно)', hist);
check('short ack echo break', out && out !== 'прикольно)', out);

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0M6_OK');
process.exit(0);
