#!/usr/bin/env node
/**
 * Smoke 0lg: expire stale «по работе» без ГС + не режем cold после work.
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-smoke-0lg';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../services/nftCampaign.js'), 'utf8');

let failed = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log(`OK ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

ok('expire_fn', /async function expireStaleNftAfterWork/.test(src));
ok('stale_reason', /stale_dialog/.test(src));
ok('clear_nft_pending', /onlyReasons:\s*\[['"]nft_pending['"]\]/.test(src));
ok('tick_calls_expire', /await expireStaleNftAfterWork\(accountId\)/.test(src));
ok('no_cold_after_work', /По работе» уже ушло/.test(src) || /cold\/interest больше не режем/.test(src));
ok(
  'due_no_shouldSkip_after_work',
  !/if \(await shouldSkipNftForLeadTier\(accountId, peerId\)\) continue;/.test(
    src.slice(src.indexOf('async function tickNftDueVoices'), src.indexOf('function pruneNftTickMap')),
  ),
);
ok('export_expire', /expireStaleNftAfterWork,/.test(src));
ok('export_stale_h', /NFT_STALE_VOICE_HOURS/.test(src));

if (failed) {
  console.error(`FAIL count=${failed}`);
  process.exit(1);
}
console.log('SMOKE_0lg_OK');
process.exit(0);
