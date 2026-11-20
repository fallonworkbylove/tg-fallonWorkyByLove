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

const soft = require('../services/softHumanLite');
check('why here detect', soft.isWhyHereAsk('Ты кста так не ответила почему ты сюда собралась'));
check('why here no false city', !soft.isWhyHereAsk('почему ты в Москву едешь'));
const fixed = soft.fixWhyHereReply('флипаю токены онлайн)', 'почему ты сюда собралась?');
check('why here rewrite nft', fixed && !/флип|токен/i.test(fixed), fixed);
const keep = soft.fixWhyHereReply('да просто поболтать зашла)', 'зачем ты тут?');
check('why here keep good', /поболтать/.test(keep));

const pipe = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
check('transport log rate', /__lrPipeTransportLog/.test(pipe));

const softSrc = fs.readFileSync(path.join(__dirname, '../services/softHumanLite.js'), 'utf8');
check('why here in softHint', /isWhyHereAsk\(userMessage\)/.test(softSrc));
check('why here in applySoftLite', /fixWhyHereReply\(out, userMessage\)/.test(softSrc));

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0M8_OK');
process.exit(0);
