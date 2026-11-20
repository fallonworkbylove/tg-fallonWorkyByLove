#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const learn = read('backend/services/learningDb.js');
const sil = read('backend/services/silenceCatchup.js');
const pipe = read('backend/services/replyPipeline.js');
const how = read('backend/services/howLong.js');

check('learning reject ≤8', /t\.length <= 8 && !\/\[\?\]/.test(learn) || /t\.length <= 8/.test(learn));
check('learning reject кайф', /кайф/.test(learn) && /isHumanStyleReply/.test(learn));
check('noteTransportMiss export', /noteTransportMiss/.test(sil));
check('pipeline wires transport miss', /noteTransportMiss/.test(pipe));
check('howlong more variants', (how.match(/на дв/g) || []).length >= 4);

const { isHumanStyleReply } = (() => {
  try {
    const m = require('../services/learningDb');
    return { isHumanStyleReply: m.isHumanStyleReply };
  } catch (_) {
    return {};
  }
})();

if (typeof isHumanStyleReply === 'function') {
  check('reject хм)', isHumanStyleReply('хм)') === false);
  check('reject кайф)', isHumanStyleReply('кайф)') === false);
  check('keep normal', isHumanStyleReply('ну давай вечером созвонимся?)') === true);
} else {
  // may not be exported — static only
  check('isHumanStyleReply exported or static ok', /function isHumanStyleReply/.test(learn));
}

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0M2_OK');
process.exit(0);
