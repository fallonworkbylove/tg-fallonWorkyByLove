#!/usr/bin/env node
'use strict';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail);
  }
}

const dbSrc = fs.readFileSync(path.join(root, 'db.js'), 'utf8');
ok('db_keepalive', /enableKeepAlive:\s*true/.test(dbSrc));
ok('db_idle', /idleTimeout/.test(dbSrc));
ok('db_connect_timeout', /connectTimeout/.test(dbSrc));

const mediaReplies = require('../services/mediaReplies');
const a = mediaReplies.pickCaption('photo', 'ru', { description: 'девушка в зеркале' });
const b = mediaReplies.pickCaption('photo', 'ru', { description: 'девушка в зеркале' });
ok('captions_pick', typeof a === 'string');
ok('captions_cache_src', /captionsCache/.test(fs.readFileSync(path.join(root, 'services/mediaReplies.js'), 'utf8')));

const silenceSrc = fs.readFileSync(path.join(root, 'services/silenceCatchup.js'), 'utf8');
ok('silence_candidates', /FROM \(\s*SELECT account_id, peer_id, MAX\(created_at\)/s.test(silenceSrc));
ok('silence_meta_skip', /META_USER_RE/.test(silenceSrc));
ok('silence_prune', /pruneHealedRecently/.test(silenceSrc));

const nftSrc = fs.readFileSync(path.join(root, 'services/nftCampaign.js'), 'utf8');
ok('nft_offset6', /LIMIT 1 OFFSET 5/.test(nftSrc));
ok('nft_no_count_star', !/SELECT COUNT\(\*\) FROM conversation_messages c\s*\n\s*WHERE c\.account_id = nvs/.test(nftSrc));
ok('nft_prune_tick', /pruneNftTickMap/.test(nftSrc));

const opsSrc = fs.readFileSync(path.join(root, 'services/opsQuality.js'), 'utf8');
ok('ops_flush_guard', /if \(!flushTimer\)/.test(opsSrc));
ok('ops_prune_maps', /pruneOpsMaps/.test(opsSrc));

const mediaSendSrc = fs.readFileSync(path.join(root, 'services/mediaSend.js'), 'utf8');
ok('own_media_mtime', /ownMediaDescMtimeMs/.test(mediaSendSrc));

ok('unused_b', typeof b === 'string');

if (fail) {
  console.error('SMOKE_0JM_FAIL', fail);
  process.exit(1);
}
console.log('ALL_OK_0jm');
process.exit(0);
