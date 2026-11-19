#!/usr/bin/env node
'use strict';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-audit';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail);
  }
}

const smoke = spawnSync(process.execPath, [path.join(__dirname, '_smoke_bundle_0ji.js')], {
  env: { ...process.env, OPENAI_API_KEY: 'sk-test' },
  encoding: 'utf8',
  timeout: 45_000,
});
check('smoke_0ji', smoke.status === 0, (smoke.stdout || smoke.stderr || '').slice(-200));

check('registry', /applyIdeasRegistryPostfilters/.test(read('services/humanIdeasRegistry.js')));
check('hh_registry', /humanIdeasRegistry/.test(read('services/humanHardening.js')));
check('nft_safe', /loadArchiveFlagsSafe/.test(read('services/nftCampaign.js')));
check('nft_reschedule', /rescheduleStaleNftSlots/.test(read('services/nftCampaign.js')));
check('silence_prio', /nft_voice_schedule/.test(read('services/silenceCatchup.js')));
check('metrics_funnel', /stuckWorkNoVoice/.test(read('services/opsLiveMetrics.js')));
check('ops_nft_watch', /runNftFunnelWatch/.test(read('services/opsQuality.js')));
check('ops_auth', /noteAuthKeyDuplicated/.test(read('services/opsQuality.js')));
check('cors_star', /s !== '\*'/.test(read('server.js')));
check('postprocess', /finalizeOutgoingReply/.test(read('services/aiResponderPostprocess.js')));
check('pipe_shared', /replyPipelineShared/.test(read('services/replyPipeline.js')));
check('changelog_0ji', /^## 0ji\./m.test(read('../CHANGELOG_TG.md')));
check('updates_v189', /updates\.js\?v=189/.test(read('../frontend/index.html')));
check('miniapp_title', /NFT воронка и живые ответы/.test(read('../frontend/updates.js')));
check('ops_title', /NFT воронка и живые ответы/.test(read('../ops-console/app/updates.js')));
check(
  'oct1_gate',
  /archived/.test(read('services/aiResponder.vps-oct1.js')),
);

if (fail) {
  console.error('HARD_AUDIT_0JI_FAIL', fail);
  process.exit(1);
}
console.log('HARD_AUDIT_0JI_OK');
process.exit(0);
