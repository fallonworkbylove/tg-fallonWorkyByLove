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

const hist = fs.readFileSync(path.join(root, 'services/history.js'), 'utf8');
ok('age_limit_400', /ORDER BY id DESC\s*\n\s*LIMIT 400/.test(hist));
ok('age_no_full_asc', !/ORDER BY created_at ASC, id ASC/.test(hist));

const soft = fs.readFileSync(path.join(root, 'services/softHumanLite.js'), 'utf8');
ok(
  'soft_no_ensure_in_apply',
  /ensureAckNotBare — один раз в finalizeOutgoingReply/.test(soft) &&
    !/out = ensureAckNotBare\(out, userMessage\);/.test(soft),
);

const nft = fs.readFileSync(path.join(root, 'services/nftCampaign.js'), 'utf8');
ok('work_sql_window', /INTERVAL \$\{workMin\} MINUTE/.test(nft));
ok('work_sql_limit', /LIMIT 24/.test(nft) && /work_mention_sent = 0/.test(nft));

const ops = fs.readFileSync(path.join(root, 'services/opsQuality.js'), 'utf8');
ok('silence_watch_candidates', /FROM \(\s*SELECT account_id, peer_id, MAX\(created_at\)/s.test(ops));
ok('silence_watch_no_interval_q', !/INTERVAL \? MINUTE/.test(ops));

const pipe = fs.readFileSync(path.join(root, 'services/replyPipeline.js'), 'utf8');
ok('outbound_prune', /pruneLastOutboundByPeer/.test(pipe));

const post = fs.readFileSync(path.join(root, 'services/aiResponderPostprocess.js'), 'utf8');
ok('finalize_ensure', /ensureAckNotBare/.test(post));

if (fail) {
  console.error('SMOKE_0JN_FAIL', fail);
  process.exit(1);
}
console.log('ALL_OK_0jn');
process.exit(0);
