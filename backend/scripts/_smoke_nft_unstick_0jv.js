#!/usr/bin/env node
/**
 * Smoke 0jv: after «по работе» NFT voice due query must NOT require recent user msg.
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../services/nftCampaign.js'),
  'utf8',
);

let failed = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log(`OK ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

const dueFn = src.slice(
  src.indexOf('async function tickNftDueVoices'),
  src.indexOf('function pruneNftTickMap'),
);

ok('due_requires_work_mention', /work_mention_sent\s*=\s*1/.test(dueFn));
ok('due_no_hard_live_user_gate', !/AND EXISTS \(\s*SELECT 1 FROM conversation_messages u[\s\S]*INTERVAL \$\{Number\(NFT_VOICE_LIVE_DIALOG_MIN\)\}/.test(dueFn));
ok('due_live_user_as_priority_only', /AS live_user/.test(dueFn) && /ORDER BY live_user DESC/.test(dueFn));
ok('due_higher_batch', /sent >= 8/.test(dueFn));
ok('comment_unstick', /nft_pending/.test(dueFn) || /молчит/.test(dueFn));
ok(
  'due_after_hours_stuck_catchup',
  /inNftHours/.test(dueFn) &&
    /INTERVAL 60 MINUTE/.test(dueFn) &&
    !/if \(!isWithinNftCampaignHours\(\)\) return;/.test(dueFn),
);

if (failed) {
  console.error(`FAIL count=${failed}`);
  process.exit(1);
}
console.log('OK all');
