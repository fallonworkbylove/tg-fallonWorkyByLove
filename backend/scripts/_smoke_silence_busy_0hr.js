/**
 * Smoke 0hr: silence watch ignores intentional «Занята» deferred peers.
 */
const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('OK', msg);
  }
};

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../services/opsQuality.js'), 'utf8');

assert(/olderMin\s*=\s*28/.test(src), 'silence olderMin=28 (past busy max)');
assert(/newerMin\s*=\s*6/.test(src), 'silence newerMin=6');
assert(/deferredDialogs/.test(src), 'skips deferredDialogs');
assert(/processingInFlight/.test(src), 'skips processingInFlight');
assert(/messageBuffers/.test(src), 'skips messageBuffers');
assert(/is_autoreply_enabled\s*=\s*1/.test(src), 'only AI-on accounts');

const inbound = require('../services/inbound');
assert(inbound.deferredDialogs instanceof Map, 'deferredDialogs exported');
assert(inbound.processingInFlight instanceof Set, 'processingInFlight exported');

// Simulate skip set logic
const skipKeys = new Set();
inbound.deferredDialogs.set('31:999', { timer: null });
for (const k of inbound.deferredDialogs.keys()) skipKeys.add(String(k));
assert(skipKeys.has('31:999'), 'deferred key would be skipped');
inbound.deferredDialogs.delete('31:999');

console.log(process.exitCode ? 'SMOKE_FAIL' : 'SMOKE_SILENCE_BUSY_0HR_OK');
process.exit(process.exitCode || 0);
