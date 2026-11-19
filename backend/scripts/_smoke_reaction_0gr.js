#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../services/replyPipeline.js'),
  'utf8',
);

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

check('sendMessageReaction exists', /async function sendMessageReaction/.test(src));
check('suppress MESSAGE_NOT_MODIFIED', /MESSAGE_NOT_MODIFIED/.test(src));
check('no error log for not modified', /MESSAGE_NOT_MODIFIED[\s\S]{0,200}return/.test(src));

if (fail) {
  console.error('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_REACTION_0GR_OK');
