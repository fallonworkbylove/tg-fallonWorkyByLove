#!/usr/bin/env node
'use strict';
/**
 * 0ms: regression — scaleIdeasPack / replyGateRegistry stay wired after soft* deploys.
 */
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';

const fs = require('fs');
const path = require('path');

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fails += 1;
    console.log('FAIL', name, detail || '');
  }
}

const gates = require('../services/softHumanGates');
const liteSrc = fs.readFileSync(
  path.join(__dirname, '../services/softHumanLite.js'),
  'utf8',
);
const hrSrc = fs.readFileSync(
  path.join(__dirname, '../services/humanRhythm.js'),
  'utf8',
);
const live = require('../services/opsLiveMetrics');

check('gates.applyWave0m1Gates', typeof gates.applyWave0m1Gates === 'function');
check('lite wires registry', /replyGateRegistry/.test(liteSrc));
check('lite applyRegisteredGates', /applyRegisteredGates/.test(liteSrc));
check('hr mood mul', /typingMoodMul|scaleIdeasPack/.test(hrSrc));
check('CLICHE_TRACK export', Array.isArray(live.CLICHE_TRACK) && live.CLICHE_TRACK.length > 0);
check(
  'pack file present',
  fs.existsSync(path.join(__dirname, '../services/scaleIdeasPack.js')),
);
check(
  'registry file present',
  fs.existsSync(path.join(__dirname, '../services/replyGateRegistry.js')),
);

const pack = require('../services/scaleIdeasPack');
const out = pack.fixSoftMeetRefuse('давай встретимся завтра', 'давай встретимся');
check('soft meet works', /переезд|разъезд|пока\s+тут|после/i.test(out), out);

if (fails) {
  console.error('SMOKE_0ms_FAIL', fails);
  process.exit(1);
}
console.log('SMOKE_0ms_OK');
process.exit(0);
