#!/usr/bin/env node
'use strict';

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

const gates = require('../services/softHumanGates');
const out = gates.fixVagueFillerReply('поняла, мелочи иногда могут быть', 'ну да');
check('vague мелочи', out && !/мелочи иногда/i.test(out), out);
const out2 = gates.fixVagueFillerReply('бывает по-разному', 'ну');
check('vague бывает', out2 && !/^бывает/i.test(out2), out2);
const keep = gates.fixVagueFillerReply('о, ладно) что с машиной?', 'машина сломалась');
check('keep real', /машин/.test(keep), keep);

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0MG_OK');
process.exit(0);
