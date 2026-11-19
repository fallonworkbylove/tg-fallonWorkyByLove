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

const pool = fs.readFileSync(path.join(__dirname, '../services/clientPool.js'), 'utf8');
const boot = fs.readFileSync(path.join(__dirname, '../services/sessionBootstrap.js'), 'utf8');
const srv = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

ok('force_close', /forceCloseClient/.test(pool));
ok('dup_no_inline_wait', /AUTH_KEY_DUPLICATED[\s\S]{0,220}return false/.test(pool));
ok('dup_no_120_block', !/жду 120с/.test(pool) && !/жду 90с/.test(pool));
ok('boot_retry_5m', /300_000/.test(boot) || /повтор[\s\S]{0,80}300/.test(boot));
ok('deactivate_all', /deactivateAllAccounts/.test(pool));
ok('graceful_sigterm', /gracefulShutdown|SIGTERM/.test(srv) && /deactivateAllAccounts/.test(srv));
ok('graceful_sigint', /SIGINT[\s\S]{0,80}gracefulShutdown\('SIGINT'\)/.test(srv));

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK');
process.exit(0);
