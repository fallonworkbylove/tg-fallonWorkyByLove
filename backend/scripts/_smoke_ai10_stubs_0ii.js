/**
 * AI→10: exact audit stubs never leave finalize / ensureAckNotBare.
 */
const soft = require('../services/softHumanLite');
const ideas14 = require('../services/humanIdeas14');
const ideas12 = require('../services/humanIdeas12');
const thin = require('../services/humanThinLayer');

const STUBS = [
  'ага)',
  'ага',
  'угу)',
  'ладно)',
  'ок)',
  'окей)',
  'круто)',
  'ну да)',
  'хм ок)',
  'здорово)',
];

let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('OK', name);
  else {
    fail++;
    console.log('FAIL', name, detail);
  }
}

for (const s of STUBS) {
  const out = soft.ensureAckNotBare(s);
  ok(`gate_${s}`, out !== s && !soft.AUDIT_EXACT_STUBS.has(String(out).toLowerCase()), out);
}

const broken = ideas14.fixBrokenWords('щас пр альное)');
ok('ideas14_no_exact_stub', !soft.AUDIT_EXACT_STUBS.has(String(broken).toLowerCase()), broken);

const mishear = ideas12.stripFalseMishear('не расслышала, повтори)', 'нормальный длинный текст про работу');
ok('ideas12_mishear', !soft.AUDIT_EXACT_STUBS.has(String(mishear).toLowerCase()), mishear);

const thanks = thin.fixServiceThanks('ок, спасибо)');
ok('thin_thanks', !soft.AUDIT_EXACT_STUBS.has(String(thanks).toLowerCase()), thanks);

const softOut = soft.applySoftLite('ага)', [], 'я с района живу давно');
ok('soft_lite_expand', !soft.AUDIT_EXACT_STUBS.has(String(softOut).toLowerCase()), softOut);

if (fail) {
  console.log('FAIL_TOTAL', fail);
  process.exit(1);
}
console.log('ALL_OK');
process.exit(0);
