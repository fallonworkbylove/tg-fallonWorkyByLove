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

const ma = require(path.join(__dirname, '../services/messageAnalysis'));

const a = ma.analyzeIncoming('где ты живёшь?', []);
assert(a.talkAlive && /по\s*сути|человеч|честно|телефон/i.test(a.talkAlive), `talkAlive → ${a.talkAlive}`);
const a2 = ma.analyzeIncoming('ну да)', [{ role: 'assistant', content: 'кофе пью)' }]);
assert(/ритме|телефон|коротко/i.test(a2.talkAlive), `talkAlive ack → ${a2.talkAlive}`);

const hint = ma.buildAnalysisHint('приятно с тобой', []);
assert(/Твой мозг сейчас/i.test(hint), 'brain frame');
assert(/Как говорить:/i.test(hint), 'talkAlive in hint');
assert(/Вайб:|Хочет:|Ход:/i.test(hint), 'core fields');
assert(hint.length < 700, `compact ${hint.length}`);

const softSrc = fs.readFileSync(path.join(__dirname, '../services/softHumanLite.js'), 'utf8');
assert(!/Для оценки: «норм»/.test(softSrc), 'soft base not essay');
assert(/Стиль: живая девушка/.test(softSrc), 'soft base short');

const thinSrc = fs.readFileSync(path.join(__dirname, '../services/humanThinLayer.js'), 'utf8');
assert(!/Типичный ритм: «привет \)»/.test(thinSrc), 'thin base slim');

const aiSrc = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
assert(/aliveStyleReminder/.test(aiSrc), 'merged alive style');
assert(!/const loveReminder/.test(aiSrc), 'no loveReminder spam');
assert(!/const humanStyleReminder/.test(aiSrc), 'no humanStyleReminder spam');
assert(!/const laughReminder/.test(aiSrc), 'no laughReminder spam');
assert(/buildAnalysisHint/.test(aiSrc), 'analysis wired');

console.log('SMOKE_0SY_OK');
process.exit(0);
