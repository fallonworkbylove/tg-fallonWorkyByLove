#!/usr/bin/env node
'use strict';
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-test';

const soft = require('../services/softHumanLite');
const i14 = require('../services/humanIdeas14');
const so = require('../services/scaleOps');
const hz = require('../services/humanizeSpeech');

let fail = 0;
function ok(name, cond, detail) {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

// A: bare stubs on substance
const enriched = soft.enrichBareAckOnSubstance('ага)', 'я с района северного');
ok('enrich_not_bare', enriched && !/^ага\)?$/i.test(enriched));
ok('enrich_no_poniala_spam', !/поняла/i.test(enriched) || enriched.length > 12);

const stub = soft.applySoftLite('ну да)', [], 'вчера был на тренировке долго');
ok('soft_stub_expanded', stub && !/^(?:ну\s+да|ага|ладно)\)?$/i.test(stub.trim()));

const safe = soft.ensureAckNotBare('ага)');
ok('safe_ack_no_poniala', !/поняла/i.test(safe));

ok('vesh_still', /вещи/i.test(i14.fixBrokenWords('собираю вещ)')));
ok('preposition_cut', !/по\s*\)?$/i.test(soft.softCompleteCut('ну просто по')));

// B: burst window 3–8с
so.noteBurstReply(9, 9);
so.noteBurstReply(9, 9);
so.noteBurstReply(9, 9);
const burst = so.burstExtraDelayMs(9, 9);
ok('burst_floor', burst >= 3000, String(burst));
ok('burst_cap', burst <= 9000, String(burst));

const p = hz.getHumanizeProfile(777);
ok('typo_soft', p.typoRate <= 0.09);
ok('burst_soft', p.shortBurstChance <= 0.11);

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK');
process.exit(0);
