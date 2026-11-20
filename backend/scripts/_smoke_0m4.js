#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

const pool = fs.readFileSync(path.join(__dirname, '../services/proxyPools.js'), 'utf8');
check('unhandled Not connected', /isNotConn/.test(pool) && /noteUnhandledSpam/.test(pool));
check('unhandled nonce', /invalid new nonce/.test(pool));

const cp = fs.readFileSync(path.join(__dirname, '../services/clientPool.js'), 'utf8');
check('activate mutex', /activateLocks/.test(cp) && /activateAccountUnlocked/.test(cp));
check('flap ttl 180s', /180_000/.test(cp));
check('nonce skip', /invalid new nonce\|SecurityError/.test(cp));

const inbound = fs.readFileSync(path.join(__dirname, '../services/inbound.js'), 'utf8');
check('voice GetFile retry', /GetFile retry/.test(inbound) && /attempt <= 2/.test(inbound));

const soft = fs.readFileSync(path.join(__dirname, '../services/softHumanLite.js'), 'utf8');
check('kaif alts no круто stub', /KAIF_ACK_ALTS[\s\S]*?ну бывает\)/.test(soft));
check('kaif alts drop круто', !/KAIF_ACK_ALTS = \[[^\]]*круто\)/.test(soft));

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0M4_OK');
process.exit(0);
