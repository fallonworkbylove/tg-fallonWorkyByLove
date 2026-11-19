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

const smoke = spawnSync(process.execPath, [path.join(__dirname, '_smoke_opt_0jl.js')], {
  env: { ...process.env, OPENAI_API_KEY: 'sk-test' },
  encoding: 'utf8',
  timeout: 45_000,
});
check('smoke_0jl', smoke.status === 0, (smoke.stdout || smoke.stderr || '').slice(-300));

check('triggers_cache', /triggersCache/.test(read('services/voiceReplies.js')));
check('nft_tick', /NFT_TICK_MIN_MS/.test(read('services/nftCampaign.js')));
check('nft_sql', /FROM nft_voice_schedule nvs/.test(read('services/nftCampaign.js')));
check('db_pool', /DB_POOL_LIMIT/.test(read('db.js')));
check('reg_hints', /buildIdeasRegistryHints/.test(read('services/humanIdeasRegistry.js')));
check('send_prep', /prepareOutboundText/.test(read('services/replySendPrep.js')));
check('ops_events', /noteAuthKeyDuplicated/.test(read('services/opsEvents.js')));
check('changelog', /^## 0jl\./m.test(read('../CHANGELOG_TG.md')));
check('v192', /updates\.js\?v=192/.test(read('../frontend/index.html')));

if (fail) {
  console.error('HARD_AUDIT_0JL_FAIL', fail);
  process.exit(1);
}
console.log('HARD_AUDIT_0JL_OK');
process.exit(0);
