#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../services/helpRequestNotifier.js'), 'utf8');

let fail = 0;
function ok(name, cond, detail) {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

ok('sets_polling_active', /pollingActive\s*=\s*true/.test(src));
ok(
  'set_before_loop',
  /pollingActive\s*=\s*true;\s*\n\s*loop\(\)/.test(src) ||
    /pollingActive = true;\r?\n\s*loop\(\)/.test(src),
);
ok('backoff_cap_45', /Math\.min\(45_000/.test(src));
ok('accept_bare_start', /startCmd === 'start'/.test(src));
ok('delete_webhook', /deleteWebhook/.test(src));
ok('socks_fallback_direct', /SOCKS fail → direct/.test(src));

if (fail) {
  console.log('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_OK');
process.exit(0);
