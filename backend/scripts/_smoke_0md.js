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

const hi = require('../services/humanIdeas10');
const bad =
  'сори, просто немного отвлеклась) могу рассказать о своих увлечениях, люблю путешествия и кофе';
const out = hi.stripCoffeeSeriesWalkCombo(bad, []);
check('strip travel+coffee hobby dump', out && !/путешеств|увлечен/i.test(out), out);
check('alt from pool', hi.ALT_HOBBY_POOL.includes(out) || (out && out.length < 80));

const classic = hi.stripCoffeeSeriesWalkCombo('я люблю кофе, сериалы и иногда гулять)', []);
check('classic still stripped', !/кофе.+сериал/i.test(classic), classic);

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0MD_OK');
process.exit(0);
