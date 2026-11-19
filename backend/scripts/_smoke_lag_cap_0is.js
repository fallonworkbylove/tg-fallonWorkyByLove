#!/usr/bin/env node
'use strict';
const so = require('../services/scaleOps');
const opsQ = require('../services/opsQuality');
const fs = require('fs');
const path = require('path');

let fail = 0;
function ok(name, cond, detail) {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

const cold = opsQ.applyTempoDelay(8000, 'cold');
ok('cold_tempo_soft', cold <= 8000 * 1.2 + 1, String(cold));

const bursts = [];
for (let i = 0; i < 5; i++) {
  so.noteBurstReply(99, 77);
  bursts.push(so.burstExtraDelayMs(99, 77));
}
ok('burst_cap', Math.max(...bursts) <= 9000, bursts.join(','));

ok(
  'load_hard_cap_code',
  /extraDelayMs: 6_000 \+ Math\.random\(\) \* 6_000/.test(
    fs.readFileSync(path.join(__dirname, '../services/scaleOps.js'), 'utf8'),
  ),
);

const pipe = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
ok('pipe_cap_14s', /Math\.min\(textDelayMs, 14_000\)/.test(pipe));
ok('pipe_no_burst_on_lifelag', /if \(!lifeLagApplied\)/.test(pipe));

const inbound = fs.readFileSync(path.join(__dirname, '../services/inbound.js'), 'utf8');
ok('gap_7s', /MIN_REPLY_GAP_MS\s*=\s*7000/.test(inbound));

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK');
process.exit(0);
