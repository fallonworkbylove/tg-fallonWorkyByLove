#!/usr/bin/env node
'use strict';
const path = require('path');
const assert = (c, m) => {
  if (!c) {
    console.error('FAIL', m);
    process.exit(1);
  }
  console.log('OK', m);
};

const ma = require(path.join(__dirname, '../services/messageAnalysis'));

const aLoc = ma.analyzeIncoming('где ты живёшь?', []);
assert(/город|где|место/i.test(aLoc.meaning), `meaning loc → ${aLoc.meaning}`);
assert(aLoc.expect === 'direct_answer', `expect loc → ${aLoc.expect}`);

const aGreet = ma.analyzeIncoming('Приветствую', []);
assert(/здрав|привет/i.test(aGreet.meaning), `meaning greet → ${aGreet.meaning}`);
assert(aGreet.expect === 'greeting_back', 'expect greeting');

const hist = [{ role: 'assistant', content: 'собираюсь переезжать скоро)' }];
const aFu = ma.analyzeIncoming('а куда?', hist);
assert(aFu.referent && /переезж/i.test(aFu.referent.text), `ref → ${JSON.stringify(aFu.referent)}`);
assert(/переезж|твоей фразе|куда/i.test(aFu.meaning), `meaning fu → ${aFu.meaning}`);

const aTired = ma.analyzeIncoming('сегодня завал устал', []);
assert(/устал|забот/i.test(aTired.meaning), `meaning tired → ${aTired.meaning}`);
assert(aTired.expect === 'care', 'expect care');

const hint = ma.buildAnalysisHint('где живёшь?', []);
assert(/ОН ИМЕЕТ В ВИДУ/i.test(hint), 'hint leads with meaning');
assert(/ЧЕГО ЖДЁТ/i.test(hint), 'hint has expect');
assert(/СДЕЛАЙ/i.test(hint), 'hint has sense must');
assert(!/НЕЛЬЗЯ:\s*канцелярит/i.test(hint) || /СМЫСЛ/i.test(hint), 'sense-first not forbid catalog');

const frag = ma.buildSoftHintFragment('типа трейдинг?', []);
assert(/имеет в виду|Ждёт/i.test(frag), `frag → ${frag}`);

const mood = ma.buildMoodOverride('приятно с тобой', []);
assert(/смысл|имеет|приятн|взаим/i.test(mood), `mood sense → ${mood}`);

const fs = require('fs');
const softSrc = fs.readFileSync(path.join(__dirname, '../services/softHumanLite.js'), 'utf8');
assert(/СМЫСЛ ЕГО СООБЩЕНИЯ/.test(softSrc), 'softHint sense label wired');
const aiSrc = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
assert(/buildAnalysisHint/.test(aiSrc), 'aiResponder analysis wired');

const aFu2 = ma.analyzeIncoming('а куда?', hist);
assert(/уточняет|переезж/i.test(aFu2.meaning), `clarify meaning → ${aFu2.meaning}`);

console.log('SMOKE_0SW_OK');
process.exit(0);
