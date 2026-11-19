#!/usr/bin/env node
'use strict';
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-test';

const fs = require('fs');
const path = require('path');
const hh = require('../services/humanHardening');
const i15 = require('../services/humanIdeas15');
const i16 = require('../services/humanIdeas16');
const soft = require('../services/softHumanLite');
const ai = require('../services/aiResponder');
const accountsSrc = fs.readFileSync(path.join(__dirname, '../routes/accounts.js'), 'utf8');
const pipeSrc = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
const inboundSrc = fs.readFileSync(path.join(__dirname, '../services/inbound.js'), 'utf8');
const proxySrc = fs.readFileSync(path.join(__dirname, '../services/proxyPools.js'), 'utf8');

let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail);
  }
}

// P0 worker-tasks gated
ok(
  'P0_worker_tasks_get',
  /router\.get\('\/worker-tasks'[\s\S]{0,120}requireOpsLoopback/.test(accountsSrc),
);
ok(
  'P0_worker_tasks_post',
  /router\.post\('\/worker-tasks'[\s\S]{0,120}requireOpsLoopback/.test(accountsSrc),
);
ok(
  'P0_worker_tasks_done',
  /worker-tasks\/:id\/done'[\s\S]{0,120}requireOpsLoopback/.test(accountsSrc),
);

// P0 deferred media wired
ok('P0_schedule_return', /scheduleDeferredMediaReturn/.test(pipeSrc));
ok('P0_fire_deferred', /fireOneDeferredMedia/.test(inboundSrc));
ok('P0_flush_deferred', /flushDueDeferredMedia/.test(inboundSrc));
hh.scheduleDeferredMedia(99, 'peerX', { delayMs: 0, kind: 'photo' });
ok('P0_peek_due', !!hh.peekDueDeferredMedia(99, 'peerX'));
ok('P0_take_due', hh.takeDueDeferredMedia(99, 'peerX')?.kind === 'photo');
ok('P0_take_empty', hh.takeDueDeferredMedia(99, 'peerX') == null);

// P1 bareOk not forced 100% when reply long
let silentHits = 0;
for (let i = 0; i < 40; i += 1) {
  if (hh.preferReactionOnlyOnBareOk('ок)', 'давай завтра встретимся у метро в шесть)', { leadTier: 'cold' })) {
    silentHits += 1;
  }
}
ok('P1_bareOk_not_always', silentHits < 40, `hits=${silentHits}`);
ok(
  'P1_bareOk_force',
  hh.preferReactionOnlyOnBareOk('ок)', 'длинный ответ про день)', { leadTier: 'cold', forceBareOk: true }) === true,
);

// P1 инст vs инструкция
ok('P1_inst_ask', /взлом/i.test(i15.softSocialHackRefuse('не даю)', 'дай инст')));
ok(
  'P1_instr_keep',
  i15.softSocialHackRefuse('смотри инструкцию внимательно)', 'прочитай инструкцию') ===
    'смотри инструкцию внимательно)',
);

// P1 научи vs научилась
ok('P1_teach', /уч|гугл|объясн/i.test(i16.fixTeachAsk('ладно)', 'научишь?')));
ok(
  'P1_nauchilas',
  i16.fixTeachAsk('я уже научилась сама)', 'ты научилась?') === 'я уже научилась сама)',
);

// P1 agree keep normal da
ok(
  'P1_keep_da_norm',
  i15.stripOverAgree('да, звучит норм)', 'может так') === 'да, звучит норм)',
);
ok('P1_still_strip_agree', i15.stripOverAgree('да, да, так и есть', 'факт') !== 'да, да, так и есть');

// P1 gender in question
ok('P1_gender_q', /устала/i.test(ai.fixFemaleSelfForms('я устал?')));

// P1 stub ну да
ok('P1_stub_nuda', !/^ну\s+да\)?$/i.test(soft.ensureAckNotBare('ну да)')));

// P2 glued
ok('P2_glued', /не сейчас/i.test(soft.fixGluedParticles('несейчас могу')));

// P2 proxy dead no attach
ok('P2_proxy_dead', /все DEAD|live != null/.test(proxySrc));

// pitch async
ok('P1_pitch_async', /shouldBlockMediaAfterPitchAsync/.test(pipeSrc));

if (fail) {
  console.error('SMOKE_FAIL_0ip', fail);
  process.exit(1);
}
console.log('ALL_OK');
