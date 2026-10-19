#!/usr/bin/env node
/**
 * Smoke: DV clarify, how-long vs asked-her-dv, exports.
 */
require('dotenv').config();
const o = require('../services/objectionHandler');
const tg = require('../services/telegramClient');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

const histDv = [
  { role: 'assistant', content: 'слушай, а ты скок дней уже сидишь на дв?' },
  { role: 'user', content: 'ну два дня был, потом неделю не заходил' },
  { role: 'assistant', content: 'поняла) ну так ты уже в теме)' },
];

assert(o.getDvClarifyHint('Какой?', histDv), 'DV clarify after в теме');
assert(!o.getDvClarifyHint('Какой?', [{ role: 'assistant', content: 'ты уже в теме)' }]), 'no DV without context');
assert(!o.isAskedHerDv('давно на дв, месяц'), 'his stay days ≠ asked her');
assert(o.isAskedHerDv('а ты давно на дв?'), 'asked her dv');
assert(!o.isAskedHerDv('ты давно тут?'), 'ты давно тут ≠ дв');
assert(typeof tg.dialogAlreadySaidGoodbye === 'function', 'dialogAlreadySaidGoodbye exported');
assert(typeof tg.cancelPendingLogin === 'function', 'cancelPendingLogin exported');

console.log('OK audit smokes');
process.exit(0);
