#!/usr/bin/env node
'use strict';
process.env.AUDIT_SMOKE = '1';

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fails += 1;
    console.log('FAIL', name, detail || '');
  }
}

const ld = require('../services/learningDb');
check(
  'reject бывает по-разному',
  ld.isHumanStyleReply('короче да, бывает по-разному') === false,
);
check(
  'reject могу попробовать',
  ld.isHumanStyleReply('иногда могу попробовать') === false,
);
check(
  'reject жизнь только начинается',
  ld.isHumanStyleReply('40 - новый 20) Жизнь только начинается)') === false,
);
check(
  'keep normal',
  ld.isHumanStyleReply('я из Липецка, переезжаю в Радужный)') === true,
);

if (fails) {
  console.error('SMOKE_0mp_FAIL', fails);
  process.exit(1);
}
console.log('SMOKE_0mp_OK');
process.exit(0);
