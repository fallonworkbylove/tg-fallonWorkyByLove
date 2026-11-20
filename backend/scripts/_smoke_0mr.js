#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fails += 1;
    console.log('FAIL', name, detail || '');
  }
}

const src = fs.readFileSync(
  path.join(__dirname, '_purge_vague_0mr.js'),
  'utf8',
);
check('purge script exists', /DELETE FROM bot_patterns/.test(src));
check('covers бывает', /бывает по-разному/.test(src));
check('covers отвлеклась', /отвлеклась/.test(src));
check('covers age', /жизнь только начинается/.test(src));
check('process.exit', /process\.exit\(0\)/.test(src));

const ld = require('../services/learningDb');
check(
  'learning still rejects',
  ld.isHumanStyleReply('короче да, бывает по-разному') === false,
);

if (fails) {
  console.error('SMOKE_0mr_FAIL', fails);
  process.exit(1);
}
console.log('SMOKE_0mr_OK');
process.exit(0);
