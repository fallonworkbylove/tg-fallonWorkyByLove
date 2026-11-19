#!/usr/bin/env node
'use strict';
const nft = require('../services/nftCampaign');
const fs = require('fs');
const path = require('path');

let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail);
  }
}

ok('voice_live_120', nft.NFT_VOICE_LIVE_DIALOG_MIN === 120, String(nft.NFT_VOICE_LIVE_DIALOG_MIN));
ok('work_live_unchanged', nft.NFT_LIVE_DIALOG_MIN === 30);
const src = fs.readFileSync(path.join(__dirname, '../services/nftCampaign.js'), 'utf8');
ok('sql_uses_const', /NFT_VOICE_LIVE_DIALOG_MIN/.test(src));

if (fail) {
  console.error('FAIL_0jj', fail);
  process.exit(1);
}
console.log('ALL_OK_0jj');
process.exit(0);
