#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../services/nftCampaign.js'), 'utf8');
const m = src.match(/NFT_LIVE_DIALOG_MIN\s*=\s*Math\.max\(\s*30,\s*Number\(process\.env\.NFT_LIVE_DIALOG_MIN\)\s*\|\|\s*(\d+)/);
if (!m || Number(m[1]) !== 90) {
  console.error('FAIL NFT_LIVE_DIALOG_MIN default not 90', m && m[1]);
  process.exit(1);
}
if (!/idleMin > NFT_LIVE_DIALOG_MIN/.test(src)) {
  console.error('FAIL gate not wired');
  process.exit(1);
}
console.log('OK live_dialog_min_90');
console.log('SMOKE_0lh_OK');
process.exit(0);
