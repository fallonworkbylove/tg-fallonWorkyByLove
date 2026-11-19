#!/usr/bin/env node
'use strict';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-smoke-test-not-real';

const { stripDayAskDupWithVoprosy } = require('../services/voiceReplies');
const { finalizeOutgoingReply } = require('../services/aiResponderPostprocess');

let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail);
  }
}

const bare = stripDayAskDupWithVoprosy('давай) как день проходит?', {
  voiceFileName: 'voprosy.ogg',
});
ok('bare_empty', !bare || !/день\s+проходит/i.test(bare), bare);

const tail = stripDayAskDupWithVoprosy('мм поняла) как день проходит?', {
  voiceFileName: 'voprosy.ogg',
});
ok('tail_stripped', /понял/i.test(tail) && !/день\s+проходит/i.test(tail), tail);

const keep = stripDayAskDupWithVoprosy('просто отдыхаю)', {
  voiceFileName: 'voprosy.ogg',
});
ok('keep_other', /отдыхаю/i.test(keep), keep);

const noVoice = stripDayAskDupWithVoprosy('как день проходит?', {});
ok('no_voice_keep', /день\s+проходит/i.test(noVoice), noVoice);

const hist = [
  { role: 'assistant', content: '[голосовое: voprosy.ogg]' },
  { role: 'user', content: 'ок' },
];
const after = stripDayAskDupWithVoprosy('поняла) как день проходит?', { history: hist });
ok('hist_strip', !/день\s+проходит/i.test(after), after);

const softOut = finalizeOutgoingReply('давай) как день проходит?', 'привет', {
  history: hist,
});
ok('final_strip', !/день\s+проходит/i.test(softOut || ''), softOut);

if (fail) {
  console.error('FAIL_0jk', fail);
  process.exit(1);
}
console.log('ALL_OK_0jk');
process.exit(0);
