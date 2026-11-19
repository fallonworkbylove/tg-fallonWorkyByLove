#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

let fail = 0;
function ok(name, cond, detail) {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

const root = path.join(__dirname, '..');
const srv = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const rl = fs.readFileSync(path.join(root, 'middleware/httpRateLimit.js'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'middleware/telegramAuth.js'), 'utf8');
const debug = fs.readFileSync(path.join(root, 'middleware/debugUser.js'), 'utf8');
const learn = fs.readFileSync(path.join(root, 'services/learningDb.js'), 'utf8');
const nft = fs.readFileSync(path.join(root, 'services/nftCampaign.js'), 'utf8');
const fe = fs.readFileSync(path.join(root, '../frontend/app.js'), 'utf8');

ok('rate_limit_mw', /httpRateLimit/.test(srv) && /240/.test(rl));
ok('connect_bucket', /accounts\/connect/.test(rl) && /30/.test(rl));
ok('security_headers', /Strict-Transport-Security/.test(srv) && /Content-Security-Policy/.test(srv));
ok('listen_localhost_prod', /LISTEN_HOST/.test(srv) && /127\.0\.0\.1/.test(srv));
ok('cors_no_star', !/origin:\s*\*/.test(srv) && !/origin:\s*true/.test(srv));
ok('bypass_loopback', /isLoopback/.test(auth) && /TELEGRAM_AUTH_BYPASS_FORCE/.test(auth));
ok('debug_dev_only', /NODE_ENV === 'development'/.test(debug));
ok('sql_ident_guard_learn', /assertSqlIdent/.test(learn));
ok('sql_ident_guard_nft', /unsafe SQL column/.test(nft));
ok('fe_escapeHtml', /function escapeHtml/.test(fe) && /escapeHtml\(/.test(fe));
ok(
  'no_hardcoded_login_pass',
  !fs
    .readFileSync(path.join(__dirname, '_check_login_ai_now.sh'), 'utf8')
    .includes('b4ea442eb8fb89cd'),
);
ok(
  'no_hardcoded_login_pass_2',
  !fs
    .readFileSync(path.join(__dirname, '_check_login_ai_now2.sh'), 'utf8')
    .includes('b4ea442eb8fb89cd'),
);

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK');
process.exit(0);
