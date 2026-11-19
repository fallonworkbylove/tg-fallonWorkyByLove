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

const smoke = spawnSync(process.execPath, [path.join(__dirname, '_smoke_opt_0jm.js')], {
  env: { ...process.env, OPENAI_API_KEY: 'sk-test' },
  encoding: 'utf8',
  timeout: 40_000,
});
check('smoke_0jm', smoke.status === 0, (smoke.stdout || smoke.stderr || '').slice(-400));

check('silence_sql', /NOT EXISTS \(\s*SELECT 1 FROM conversation_messages b/s.test(read('services/silenceCatchup.js')));
check('captions_cache', /captionsCache/.test(read('services/mediaReplies.js')));
check('flush_guard', /flushTimer/.test(read('services/opsQuality.js')));
check('db_keep', /enableKeepAlive/.test(read('db.js')));
check('nft_offset', /OFFSET 5/.test(read('services/nftCampaign.js')));
check('changelog', /^## 0jm\./m.test(read('../CHANGELOG_TG.md')));
check('v193', /updates\.js\?v=193/.test(read('../frontend/index.html')));

if (fail) {
  console.error('HARD_AUDIT_0JM_FAIL', fail);
  process.exit(1);
}
console.log('HARD_AUDIT_0JM_OK');
process.exit(0);
