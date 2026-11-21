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
assert(/интерес|узнаёт|город/i.test(a.vibe), `vibe → ${a.vibe}`);
assert(/город|где/i.test(a.subtext + a.herMove), `sub/move → ${a.subtext} | ${a.herMove}`);

const g = ma.analyzeIncoming('Приветствую', []);
assert(/привет|зашёл/i.test(g.vibe), `greet vibe → ${g.vibe}`);
assert(/привет/i.test(g.herMove), `greet move → ${g.herMove}`);

const hist = [{ role: 'assistant', content: 'собираюсь переезжать скоро)' }];
const f = ma.analyzeIncoming('а куда?', hist);
assert(/уточн|переезж/i.test(f.meaning + f.herMove), `fu → ${f.meaning} | ${f.herMove}`);

const hint = ma.buildAnalysisHint('сегодня завал устал', []);
assert(/Прочитай его сообщение как живая девушка/i.test(hint), 'girl frame');
assert(/Вайб:/i.test(hint) && /Чего хочет:/i.test(hint) && /Твой ход:/i.test(hint), 'vibe/subtext/move');
assert(!/Тип:\s*question/i.test(hint), 'no bureaucratic type dump');
assert(!/НЕЛЬЗЯ:/i.test(hint), 'no forbid catalog');
assert(hint.length < 900, `compact hint len=${hint.length}`);

assert(ma.buildSoftHintFragment('x', []) === null, 'no softHint fragment spam');

const softSrc = fs.readFileSync(path.join(__dirname, '../services/softHumanLite.js'), 'utf8');
assert(!/ВАЖНО СЕЙЧАС: он устал/.test(softSrc), 'softHint tired point-case gone');
assert(!/СМЫСЛ ЕГО СООБЩЕНИЯ/.test(softSrc), 'no sense dup in softHint');
assert(/isWhyHereAsk/.test(softSrc) && /isDatingSiteAsk/.test(softSrc), 'business cases kept');

const thinSrc = fs.readFileSync(path.join(__dirname, '../services/humanThinLayer.js'), 'utf8');
assert(!/Он поздоровался — ответь приветом/.test(thinSrc), 'thin no analysis dup');

const aiSrc = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
assert(/buildAnalysisHint/.test(aiSrc) && /buildMoodOverride/.test(aiSrc), 'ai wired');

console.log('SMOKE_0SX_OK');
process.exit(0);
