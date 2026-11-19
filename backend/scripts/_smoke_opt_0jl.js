#!/usr/bin/env node
'use strict';
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

// triggers cache
ok('triggers_cache', /triggersCache|mtimeMs/.test(read('services/voiceReplies.js')));

// NFT tick throttle + shared archive
const nft = require('../services/nftCampaign');
ok('nft_tick_ms', nft.NFT_TICK_MIN_MS >= 60_000, String(nft.NFT_TICK_MIN_MS));
ok('nft_shared_flags', /archiveFlagsShared|loadArchiveFlagsSafe\(client, accountId\)/.test(read('services/nftCampaign.js')));
ok('nft_due_slots', /FROM nft_voice_schedule nvs/.test(read('services/nftCampaign.js')));
ok('nft_lazy_objection', /const objectionHandler = require/.test(read('services/nftCampaign.js')));

// db pool
ok('db_pool', /DB_POOL_LIMIT|connectionLimit/.test(read('db.js')) && /25/.test(read('db.js')));

// registry hints
const reg = require('../services/humanIdeasRegistry');
ok('reg_hints', typeof reg.buildIdeasRegistryHints === 'function');
ok('hh_reg_hints', /buildIdeasRegistryHints/.test(read('services/humanHardening.js')));

// finalize single ack + voprosy
ok('final_voprosy', /stripDayAskDupWithVoprosy/.test(read('services/aiResponderPostprocess.js')));
ok('hh_no_ensure', !/ensureAckNotBare\(out, userMessage\)/.test(read('services/humanHardening.js')));

// send prep
ok('send_prep', /prepareOutboundText/.test(read('services/replyPipeline.js')));
ok('ops_events', /opsEvents/.test(read('services/clientPool.js')));
ok('ops_listen', /opsEvents.*authKeyDuplicated|on\('authKeyDuplicated'/.test(read('services/opsQuality.js')));

// bak gone
ok(
  'no_bak',
  !fs.existsSync(path.join(root, 'services/aiResponder.js.bak-daytest-oct1-live')) &&
    !fs.existsSync(path.join(root, 'services/aiResponder.vps-oct1.js.archived')),
);

// oct1 still gated
let threw = false;
try {
  require('../services/aiResponder.vps-oct1');
} catch (e) {
  threw = /archived/i.test(String(e.message || e));
}
ok('oct1_gate', threw);

finishSmoke(fail === 0, fail ? `FAIL_0jl_${fail}` : 'ALL_OK_0jl').catch(() => {
  process.exit(fail ? 1 : 0);
});
