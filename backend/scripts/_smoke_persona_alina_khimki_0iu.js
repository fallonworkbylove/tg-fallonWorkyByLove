#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const so = require('../services/scaleOps');
const pf = require('../services/personaFacts');

let fail = 0;
function ok(name, cond, detail) {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

ok('prep_khimki', pf.inCityPrep('Химки') === 'Химках', pf.inCityPrep('Химки'));
ok('acc_khimki', pf.inCityAcc('Химки') === 'Химки', pf.inCityAcc('Химки'));

const p = fs.readFileSync(path.join(__dirname, '../../prompts/alina_khimki.txt'), 'utf8');
ok('file_name_age', /^Ты Алина, 24 года\./m.test(p), p.slice(0, 40));
ok('file_move', /переезжаешь в Химки/.test(p) && /в Химках/.test(p));
ok('file_from', /живёшь в Липецке/.test(p));
ok('file_acc_lc', /в химки/.test(p));

const t = (so.PERSONA_TEMPLATES || []).find((x) => x.id === 'alina_khimki');
ok('tpl', !!t && t.title === 'Алина · Химки');
ok('tpl_prompt', t && /Алина, 24 года/.test(t.prompt) && /Химках/.test(t.prompt));

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK');
process.exit(0);
