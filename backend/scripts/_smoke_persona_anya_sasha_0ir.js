#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const so = require('../services/scaleOps');

let fail = 0;
function ok(name, cond, detail) {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

const anyaPath = path.join(__dirname, '../../prompts/anya_kazan.txt');
const sashaPath = path.join(__dirname, '../../prompts/sasha_samara.txt');
const anya = fs.readFileSync(anyaPath, 'utf8');
const sasha = fs.readFileSync(sashaPath, 'utf8');

ok('anya_exists', anya.length > 500);
ok('sasha_exists', sasha.length > 500);
ok('anya_name_age', /^Ты Аня, 25 лет\./m.test(anya), anya.slice(0, 40));
ok('sasha_name_age', /^Ты Саша, 24 года\./m.test(sasha), sasha.slice(0, 40));
ok('anya_kazan', /переезжаешь в Казань/.test(anya) && /в Казани/.test(anya));
ok('sasha_samara', /переезжаешь в Самару/.test(sasha) && /в Самаре/.test(sasha));
ok('anya_lipetsk', /живёшь в Липецке/.test(anya));
ok('sasha_lipetsk', /живёшь в Липецке/.test(sasha));
ok('anya_acc_lc', /в казань/.test(anya));
ok('sasha_acc_lc', /в самару/.test(sasha));

const ids = (so.PERSONA_TEMPLATES || []).map((t) => t.id);
ok('tpl_anya', ids.includes('anya_kazan'), ids.join(','));
ok('tpl_sasha', ids.includes('sasha_samara'), ids.join(','));

const tAnya = so.PERSONA_TEMPLATES.find((t) => t.id === 'anya_kazan');
const tSasha = so.PERSONA_TEMPLATES.find((t) => t.id === 'sasha_samara');
ok('tpl_anya_prompt', tAnya && /Аня, 25 лет/.test(tAnya.prompt) && /Казань/.test(tAnya.prompt));
ok('tpl_sasha_prompt', tSasha && /Саша, 24 года/.test(tSasha.prompt) && /Самару/.test(tSasha.prompt));

const filled24 = so.fillPersonaTemplate('Ты {{NAME}}, {{AGE_YEARS}}.', { name: 'Саша', age: '24' });
ok('age_years_24', filled24 === 'Ты Саша, 24 года.', filled24);
const filled25 = so.fillPersonaTemplate('Ты {{NAME}}, {{AGE_YEARS}}.', { name: 'Аня', age: '25' });
ok('age_years_25', filled25 === 'Ты Аня, 25 лет.', filled25);

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK');
process.exit(0);
