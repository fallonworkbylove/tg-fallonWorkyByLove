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

const hi = require('../services/humanIdeas14');
check('бувет→будет', /будет/.test(hi.fixBrokenWords('там бувет удобнее')));
check('отншмает', /отнимает/.test(hi.fixBrokenWords('работа отншмает всё')));
check('можео', /можно/.test(hi.fixBrokenWords('можео и так)')));
check('ноч→ночи', /ночи/.test(hi.fixBrokenWords('спокойной ноч)')));

const plat = hi.stripAgePlatitude('40 - новый 20) Жизнь только начинается)');
check('age platitude gone', plat && !/новый\s*20|начинается/i.test(plat), plat);

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0MF_OK');
process.exit(0);
