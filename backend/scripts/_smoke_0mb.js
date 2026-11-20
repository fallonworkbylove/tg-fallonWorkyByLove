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

const soft = fs.readFileSync(path.join(__dirname, '../services/softHumanLite.js'), 'utf8');
check('hint bans отвлеклась', /БЕЗ слова «отвлеклась»/.test(soft));

const hh = require('../services/humanHardening');
const hist = [
  { role: 'assistant', content: 'сорри, отвлеклась)' },
  { role: 'user', content: 'ну и?' },
];
const out = hh.stripRepeatPonialaHah('ой, просто отвлеклась) как дела?', hist);
check('strip отвлеклась echo', out && !/отвлеклась/i.test(out), out);
const out2 = hh.stripRepeatPonialaHah(
  'сорри, отвлеклась)',
  [],
  'опять ничего не ответила',
);
check('strip on silence complaint', out2 && !/отвлеклась/i.test(out2), out2);

const ld = fs.readFileSync(path.join(__dirname, '../services/learningDb.js'), 'utf8');
check('learning reject отвлеклась', /отвлеклась/.test(ld) && /t\.length <= 48/.test(ld));

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0MB_OK');
process.exit(0);
