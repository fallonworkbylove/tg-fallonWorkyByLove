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

const warm = ma.analyzeIncoming('приятно с тобой', []);
assert(/любвеобильн|взаимн|нежн|приятн/i.test(warm.talkAlive + warm.herMove), `warm → ${warm.talkAlive} | ${warm.herMove}`);

const base = ma.analyzeIncoming('ну да)', [{ role: 'assistant', content: 'кофе)' }]);
assert(/любвеобильн|тепл|приятн/i.test(base.talkAlive), `base alive → ${base.talkAlive}`);

const hint = ma.buildAnalysisHint('привет', []);
assert(/любвеобильн/i.test(hint), 'hint loving');
assert(/нежност|милый|приятн|тепл|любвеобильн/i.test(ma.buildMoodOverride('норм', [])), 'mood loving');
assert(/updates\.js\?v=508/.test(fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8')), 'v=508');

const aiSrc = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
assert(/любвеобильн/i.test(aiSrc), 'aliveStyle loving');
assert(/милый|приятно|рада что написал/i.test(aiSrc), 'affection phrases');

const softSrc = fs.readFileSync(path.join(__dirname, '../services/softHumanLite.js'), 'utf8');
assert(/любвеобильн/i.test(softSrc), 'soft loving');

console.log('SMOKE_0SZ_OK');
process.exit(0);
