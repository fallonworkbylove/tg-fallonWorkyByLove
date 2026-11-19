#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const soft = require('../services/softHumanLite');
const nft = fs.readFileSync(path.join(__dirname, '../services/nftCampaign.js'), 'utf8');
const help = fs.readFileSync(path.join(__dirname, '../services/helpRequestNotifier.js'), 'utf8');
const desc = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../media/own_media_desc.json'), 'utf8'),
);

let fail = 0;
function ok(name, cond, detail) {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

ok(
  'desc_41_concert',
  /концерт|тусовк/i.test(desc['https://t.me/+XdTSk_ow2s4zYzA6#41'] || ''),
  desc['https://t.me/+XdTSk_ow2s4zYzA6#41'],
);
ok('nft_pending_on_work', /nft_pending/.test(nft) && /disableAutoreplyForPeer/.test(nft));
ok('nft_voice_allows_pending', /pauseReason !== 'nft_pending'/.test(nft));
ok('protect_nft_pending', /nft_pending/.test(help) && /PROTECTED_DISABLE_REASONS/.test(help));
ok('export_get_reason', /getAutoreplyDisableReason/.test(help));

const hist = [
  {
    role: 'assistant',
    content:
      '[медиа:#41] {кружок: На концерте / тусовке, красный свет, шумно вокруг. (снято вечером, темно)}',
  },
];
const fixed = soft.fixCirclePlaceMismatch('дома, в уютном кресле', hist, 'Это где ты?');
ok('fix_home_after_concert', /концерт/i.test(fixed) && !/дома|кресл/i.test(fixed), fixed);
const keep = soft.fixCirclePlaceMismatch('на концерте))', hist, 'Это где ты?');
ok('keep_ok_concert', /концерт/i.test(keep), keep);

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK');
process.exit(0);
