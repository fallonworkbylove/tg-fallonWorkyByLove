#!/usr/bin/env node
'use strict';
/**
 * 0mj: kill «отвлеклась» at source + vague «короче да, бывает по-разному» / «что-то не так».
 */
const path = require('path');
const fs = require('fs');

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fails += 1;
    console.log('FAIL', name, detail || '');
  }
}

const hh = require('../services/humanHardening');
const gates = require('../services/softHumanGates');
const he = require('../services/humanExtra');

const inboundSrc = fs.readFileSync(
  path.join(__dirname, '../services/inbound.js'),
  'utf8',
);
check(
  'inbound later_text without отвлеклась',
  /const phrases = \[/.test(inboundSrc) && !/сорри, отвлеклась/.test(inboundSrc),
);
check(
  'inbound has ой сорри',
  /ой сорри\)/.test(inboundSrc),
);

const stripped = hh.stripRepeatPonialaHah(
  'сорри, отвлеклась) чем ты сейчас занят?',
  [],
  'привет',
);
check(
  'always strip отвлеклась',
  stripped && !/отвлеклась/i.test(stripped),
  stripped,
);

const hint = he.awayReturnHint(50);
check(
  'away hint without отвлеклась word as suggestion',
  hint && /НЕ пиши слово «отвлеклась»/.test(hint) && !/сорри отвлеклась/.test(hint),
  hint,
);

const vague1 = gates.fixVagueFillerReply('короче да, бывает по-разному', 'ну да');
check(
  'vague короче бывает по-разному',
  vague1 && !/бывает\s+по[- ]?разному/i.test(vague1),
  vague1,
);

const vague2 = gates.fixVagueFillerReply('ахах, что-то не так', 'ну');
check(
  'vague что-то не так',
  vague2 && !/что-то\s+не\s+так/i.test(vague2),
  vague2,
);

const hhSrc = fs.readFileSync(
  path.join(__dirname, '../services/humanHardening.js'),
  'utf8',
);
check(
  'no бывает по-разному alt in expand',
  !/короче да, бывает по-разному/.test(hhSrc),
);

if (fails) {
  console.error('SMOKE_0mj_FAIL', fails);
  process.exit(1);
}
console.log('SMOKE_0mj_OK');
process.exit(0);
