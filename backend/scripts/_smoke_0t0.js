#!/usr/bin/env node
'use strict';
const path = require('path');
const fs = require('fs');
const assert = (c, m) => {
  if (!c) {
    console.error('FAIL', m);
    process.exit(1);
  }
  console.log('OK', m);
};

const aiSrc = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
assert(/craftReminder/.test(aiSrc), 'craftReminder');
assert(!/const noMeetReminder/.test(aiSrc), 'noMeet merged');
assert(!/const lengthReminder/.test(aiSrc), 'length merged');
assert(!/const answerFirstReminder/.test(aiSrc), 'answerFirst merged');

const noRep = aiSrc.match(/const noRepeatReminder =\s*\n?\s*'([^']*(?:'\\''[^']*)*)'/);
// fallback: extract between noRepeatReminder = and ;
const start = aiSrc.indexOf('const noRepeatReminder');
const slice = aiSrc.slice(start, start + 1200);
assert(!/Переезд насовсем/.test(slice), 'noRepeat not essay');
assert(/Смотри историю/.test(slice), 'noRepeat compact');
assert(slice.indexOf("';") < 550 || /мелочь дня/.test(slice), 'noRepeat shortish');

const ma = require(path.join(__dirname, '../services/messageAnalysis'));
const day = ma.analyzeIncoming('как дела?', []);
assert(/мелочь|кофе|переезд/i.test(day.herMove + day.subtext), `day → ${day.herMove} | ${day.subtext}`);

const hint = ma.buildAnalysisHint('как дела?', []);
assert(hint.length < 650, `hint compact ${hint.length}`);
assert(/Твой мозг|Вайб|Ход/i.test(hint), 'brain still there');

console.log('SMOKE_0T0_OK');
process.exit(0);
