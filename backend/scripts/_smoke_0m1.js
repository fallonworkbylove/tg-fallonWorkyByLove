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

const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const pp = read('backend/services/proxyPools.js');
const ops = read('backend/services/opsQuality.js');
const sil = read('backend/services/silenceCatchup.js');
const soft = read('backend/services/softHumanLite.js');
const ultra = read('backend/scripts/_ultra_hard_audit.js');
const guard = read('backend/scripts/_deploy_guard.sh');

check('dead TTL never shorten', /Math\.max\(deadUntil\.get\(key\)/.test(pp));
check('markByHost openai-only', /OpenAI-only host|DEAD socks5 \$\{h\}/.test(pp));
check('socks hook DEFAULT TTL', /markProxyDead\(found, msg\.slice\(0, 80\), DEFAULT_DEAD_TTL_MS\)/.test(pp));
check('offline uptime 600', /uptime\(\) < 600/.test(ops));
check('offline session_string', /CHAR_LENGTH\(a\.session_string\) > 40/.test(ops));
check('offline threshold 4', /n < 4 && n \/ total < 0\.35/.test(ops));
check('offline night skip', /isNightTextQuietHour/.test(ops) && /runAccountOfflineWatch/.test(ops));
check('night bye heal skip', /NIGHT_BYE_RE/.test(sil) && /сладких\\s\+снов/.test(sil));
check('ultraShort ≤8', /body\.length <= 8/.test(soft));
check('ultra theme acid green', /#b8ff3c/.test(ultra));
check('guard CORS warn', /CORS_ORIGIN=\*/.test(guard));

const softMod = require('../services/softHumanLite');
const out = softMod.ensureAckNotBare('хм)', 'как день?');
check('ensureAck expands хм)', out && out !== 'хм)' && out.length > 3, out);

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_0M1_OK');
process.exit(0);
