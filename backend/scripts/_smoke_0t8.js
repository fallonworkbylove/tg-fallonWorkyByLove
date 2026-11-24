'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
const fs = require('fs');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const ma = require(path.join(__dirname, '../services/messageAnalysis'));
const barterDebt = ma.detectThreadDebt(
  [{ role: 'assistant', content: 'хорошо скину, но сначала ты)' }],
  'ну и где фото',
);
assert(barterDebt.debts.some((d) => /бартер|собачка|давит/i.test(d)), 'barter debt');

const ageFact = ma.detectThreadDebt([], 'мне 29 лет, работаю');
assert(ageFact.facts.some((f) => /возраст:\s*29/.test(f)), 'age fact');

const lt = fs.readFileSync(path.join(__dirname, '../services/lifeTexture.js'), 'utf8');
assert(/rand\(\) < 0\.62/.test(lt), 'disagree bump');
assert(/rand\(\) < 0\.14/.test(lt), 'character bump');

console.log('SMOKE_0t8_OK');
process.exit(0);
