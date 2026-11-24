'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
const fs = require('fs');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const media = require(path.join(__dirname, '../services/mediaReciprocity'));
assert(media.isAggressive('давай быстрее скинь'), 'faster');
assert(media.isAggressive('сколько можно ждать'), 'skolko');
assert(!media.isAggressive('скинь кружок когда сможешь)'), 'soft ask ok');
const ai = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
assert(/ахах ладно\)»/.test(ai), 'craft ban');
console.log('SMOKE_0t36_OK');
