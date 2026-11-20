#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fails += 1;
    console.log('FAIL', name, detail || '');
  }
}

const src = fs.readFileSync(
  path.join(__dirname, '../services/telegramClient.js'),
  'utf8',
);
check('tickNftCampaignSafe', /tickNftCampaignSafe/.test(src));
check('retry ECONNREFUSED', /ECONNREFUSED/.test(src) && /setTimeout\(r, 400\)/.test(src));
check('rate-limit NFT err', /5 \* 60_000/.test(src) || /5 \* 60 \* 1000/.test(src));
check('log NFT tick not old label', /NFT tick:/.test(src));
check(
  'no old misleading label',
  !/Фраза про работу перед голосовым/.test(src),
);

const i15 = fs.readFileSync(
  path.join(__dirname, '../services/humanIdeas15.js'),
  'utf8',
);
check('no слышу а подробнее alt', !/слышу\) а подробнее\?/.test(i15));

if (fails) {
  console.error('SMOKE_0mn_FAIL', fails);
  process.exit(1);
}
console.log('SMOKE_0mn_OK');
process.exit(0);
