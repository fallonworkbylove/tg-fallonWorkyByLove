#!/usr/bin/env node
'use strict';
/**
 * Smoke 0ji: NFT funnel + ideas registry + bare ack + archive fallback + CORS * + oct1 gate.
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-smoke-test-not-real';

const fs = require('fs');
const path = require('path');
const { finishSmoke } = require('./_smoke_runner');

let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail);
  }
}

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// 2 voice tag diag
ok('diag_voice_tag', /голосовое: nft\.ogg/.test(read('scripts/_diag_nft_now.js')));
ok('diag_no_old_voice', !/%\[voice:nft\.ogg\]%/.test(read('scripts/_diag_nft_now.js')));

// 5+15 registry
const reg = require('../services/humanIdeasRegistry');
ok('registry_slots', Array.isArray(reg.IDEAS_SLOTS) && reg.IDEAS_SLOTS.length >= 9);
ok(
  'registry_apply',
  typeof reg.applyIdeasRegistryPostfilters === 'function',
);
const hh = read('services/humanHardening.js');
ok('hh_uses_registry', /humanIdeasRegistry/.test(hh));
ok('hh_single_expand', (hh.match(/expandBareStubOnQuestion\(out/g) || []).length === 1);
ok('hh_final_ensure', /ensureAckNotBare/.test(hh));

// 6 bare ack
const soft = require('../services/softHumanLite');
ok('stub_denylist', soft.STUB_DENYLIST && soft.STUB_DENYLIST.has('ну да)'));
const enriched = soft.ensureAckNotBare('ну да)');
ok('ensure_not_bare', enriched && !/^ну\s+да\)?$/i.test(enriched), enriched);

// 8 postprocess
const post = require('../services/aiResponderPostprocess');
ok(
  'postprocess_gate',
  !/^ага\)?$/i.test(post.finalizeOutgoingReply('ага)', 'как дела?')),
);

// 7 shared
ok(
  'pipe_shared',
  /replyPipelineShared/.test(read('services/replyPipeline.js')),
);

// 9+ archive + cold interest
const nft = require('../services/nftCampaign');
ok('archive_safe', typeof nft.loadArchiveFlagsSafe === 'function');
ok('skip_tier', typeof nft.shouldSkipNftForLeadTier === 'function');
ok('reschedule', typeof nft.rescheduleStaleNftSlots === 'function');
ok('nft_metrics_wire', /opsLiveMetrics/.test(read('services/nftCampaign.js')));

// 13 CORS *
ok('cors_star_filtered', /s !== '\*'/.test(read('server.js')));

// 14 ops
const oq = read('services/opsQuality.js');
ok('nft_funnel_watch', /runNftFunnelWatch/.test(oq));
ok('auth_key_watch', /noteAuthKeyDuplicated/.test(oq));
ok('client_auth_note', /noteAuthKeyDuplicated/.test(read('services/clientPool.js')));

// 4 silence prioritize
ok('silence_nft_prio', /nft_voice_schedule/.test(read('services/silenceCatchup.js')));

// 1 metrics funnel
ok('live_nft_funnel', /nftFunnel|stuckWorkNoVoice/.test(read('services/opsLiveMetrics.js')));

// 17 oct1 gate
let threw = false;
try {
  require('../services/aiResponder.vps-oct1');
} catch (e) {
  threw = /archived/i.test(String(e.message || e));
}
ok('oct1_gated', threw);
ok(
  'oct1_archived_file',
  fs.existsSync(path.join(root, 'services/aiResponder.vps-oct1.js.archived')),
);

finishSmoke(fail === 0, fail ? `FAIL_0ji_${fail}` : 'ALL_OK_0ji').catch(() => {
  process.exit(fail ? 1 : 0);
});
