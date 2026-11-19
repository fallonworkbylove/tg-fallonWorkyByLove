#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail);
  }
}

const i16 = fs.readFileSync(path.join(root, 'services/humanIdeas16.js'), 'utf8');
const hh = fs.readFileSync(path.join(root, 'services/humanHardening.js'), 'utf8');
const smoke = fs.readFileSync(path.join(__dirname, '_smoke_human16_0io.js'), 'utf8');

ok('ideas16_module', /applyIdeas16Postfilters/.test(i16) && /buildIdeas16Hints/.test(i16));
ok('ideas16_hooks', /stripEmptySoftFillers/.test(i16) && /fixTeachAsk/.test(i16));
ok('ideas16_walk', /fixFalseMeetOnHisWalk/.test(i16));
ok('ideas16_huh', /stripHuhConfusion/.test(i16));
ok('ideas16_therapist', /stripTherapistTone/.test(i16));
ok('wire_hints', /buildIdeas16Hints/.test(hh));
ok('wire_post', /applyIdeas16Postfilters/.test(hh));
ok('smoke_exists', /ALL_OK/.test(smoke));

const mod = require('../services/humanIdeas16');
ok('runtime_teach', /уч|учитель|объясн/i.test(mod.fixTeachAsk('ок)', 'научишь?')));
ok('runtime_walk', !/не\s+до\s+встреч/i.test(
  mod.fixFalseMeetOnHisWalk('не до встреч)', 'гуляю по городу'),
));

if (fail) {
  console.error('HARD_AUDIT_0IO_FAIL', fail);
  process.exit(1);
}
console.log('HARD_AUDIT_0IO_OK');
