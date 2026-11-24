'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
const fs = require('fs');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const media = fs.readFileSync(path.join(__dirname, '../services/mediaReciprocity.js'), 'utf8');
assert(/хех ну сначала ты/.test(media), 'barter alt');
assert(/не по приказу/.test(media), 'refuse alt');
const reg = fs.readFileSync(path.join(__dirname, '../services/replyGateRegistry.js'), 'utf8');
assert(/'ахах ладно\)'/.test(reg), 'live cliche');
console.log('SMOKE_0t34_OK');
