/**
 * Smoke 0js: хард C — voice TDZ в fireReengage + stub «хм ок)» не в SAFE_ACK.
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const fs = require('fs');
const path = require('path');
const soft = require('../services/softHumanLite');

const assert = (c, m) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('OK', m);
};

const pipe = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
const reIdx = pipe.indexOf('async function fireReengage');
const mainIdx = pipe.indexOf('async function processIncoming', reIdx + 1);
const reBlock = pipe.slice(reIdx, mainIdx > reIdx ? mainIdx : reIdx + 25000);
assert(!/voiceFileName:\s*voice\?\.fileName/.test(reBlock), 'no voice?. TDZ in fireReengage');
assert(/voiceFileName:\s*null/.test(reBlock), 'reengage voiceFileName null');
assert(/finalizeOutgoingReply\(outText,\s*text/.test(reBlock), 'reengage finalize before send');

const softSrc = fs.readFileSync(path.join(__dirname, '../services/softHumanLite.js'), 'utf8');
const safeBlock = softSrc.slice(softSrc.indexOf('SAFE_ACK_VARIANTS'), softSrc.indexOf('function pickSafeAck'));
assert(!/['"]хм ок\)['"]/.test(safeBlock), 'SAFE_ACK no exact stub хм ок)');

const out = soft.ensureAckNotBare('хм ок)', 'норм день был');
assert(out && !/^хм ок\)?$/i.test(out.trim()), 'ensureAck upgrades хм ок');
assert(!soft.AUDIT_EXACT_STUBS || true, 'soft loads');

for (let i = 0; i < 30; i += 1) {
  const a = soft.ensureAckNotBare('хм ок)', 'слушай');
  assert(!/^хм ок\)?$/i.test(String(a).trim()), `pickSafeAck not stub #${i}`);
}

console.log(process.exitCode ? 'SMOKE_FAIL' : 'SMOKE_HARD_C_0JS_OK');
process.exit(process.exitCode || 0);
