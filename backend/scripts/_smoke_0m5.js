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

const ai = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
check('circuit export', /isOpenAiCircuitOpen/.test(ai) && /module\.exports\.isOpenAiCircuitOpen/.test(ai));

const rag = fs.readFileSync(path.join(__dirname, '../services/ragExamples.js'), 'utf8');
check('embed skip circuit', /isOpenAiCircuitOpen/.test(rag));
check('embed fail rate limit', /noteEmbedFail/.test(rag) && /embedFailN/.test(rag));

const sil = fs.readFileSync(path.join(__dirname, '../services/silenceCatchup.js'), 'utf8');
check('night bye ночки', /ноч\(\?:и\|ки\)/.test(sil) || /ноч(?:и|ки)/.test(sil));
check('night bye пойду спать', /пойду\\s\+спать/.test(sil));

const ops = fs.readFileSync(path.join(__dirname, '../services/opsQuality.js'), 'utf8');
check('waiting night ночки', /ноч\(и\|ки\)/.test(ops));

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0M5_OK');
process.exit(0);
