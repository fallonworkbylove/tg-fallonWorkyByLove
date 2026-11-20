#!/usr/bin/env node
'use strict';
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fails += 1;
    console.log('FAIL', name, detail || '');
  }
}

const fs = require('fs');
const path = require('path');
const softSrc = fs.readFileSync(
  path.join(__dirname, '../services/softHumanLite.js'),
  'utf8',
);
check(
  'softLite wires stripAgePlatitude',
  /stripAgePlatitude/.test(softSrc) &&
    softSrc.indexOf('stripAgePlatitude') !== softSrc.lastIndexOf('stripAgePlatitude'),
);

const hh = require('../services/humanHardening');
const hist = [
  { role: 'assistant', content: 'ахаха' },
  { role: 'user', content: 'лол' },
];
const out = hh.stripRepeatPonialaHah('ахаха, ну да) бывает', hist, 'лол');
check('ahaha nu da strip', out && !/^ахаха/i.test(out), out);

const gates = require('../services/softHumanGates');
const vague = gates.fixVagueFillerReply('ну такое)', 'ну да');
check('vague ну такое', vague && !/^ну\s+такое/i.test(vague), vague);

const i14 = require('../services/humanIdeas14');
const plat = i14.stripAgePlatitude('40 - новый 20) Жизнь только начинается)');
check('age platitude', plat && !/жизнь\s+только\s+начинается/i.test(plat), plat);

const hhSrc = fs.readFileSync(
  path.join(__dirname, '../services/humanHardening.js'),
  'utf8',
);
check('PHRASE_ALTS without ну такое', !/'ну такое\)'/.test(hhSrc));

if (fails) {
  console.error('SMOKE_0ml_FAIL', fails);
  process.exit(1);
}
console.log('SMOKE_0ml_OK');
process.exit(0);
