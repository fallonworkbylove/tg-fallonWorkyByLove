#!/usr/bin/env node
/**
 * Connection error. (OpenAI SDK) must be transport → failover rotates.
 * Silence-heal: CALL_ONLY skip + fail cooldown.
 */
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';
process.env.PROXY_LIST =
  'socks5:1.1.1.1:8000:u:p;socks5:2.2.2.2:8000:u:p;socks5:3.3.3.3:8000:u:p';
process.env.AUDIT_SMOKE = '1';

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

delete require.cache[require.resolve('../services/proxyPools')];
const pp = require('../services/proxyPools');

check(
  'Connection error. is transport',
  pp.isProxyTransportError(new Error('Connection error.')),
);
check(
  'APIConnectionError name',
  pp.isProxyTransportError({ name: 'APIConnectionError', message: 'Connection error.' }),
);
check(
  'ECONNRESET code',
  pp.isProxyTransportError({ message: 'failed', code: 'ECONNRESET' }),
);
check(
  'auth not transport',
  !pp.isProxyTransportError(new Error('Incorrect API key provided')),
);

const aiSrc = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
check('export failover', /module\.exports\.openaiCreateWithProxyFailover/.test(aiSrc));
check('Connection error fallback regex', /Connection error/.test(aiSrc));
check(
  'circuit only after pool exhaust',
  /if \(transportFails > 0\) noteOpenAiCircuit\(false\)/.test(aiSrc),
);

const ragSrc = fs.readFileSync(path.join(__dirname, '../services/ragExamples.js'), 'utf8');
check('rag uses failover', /openaiCreateWithProxyFailover/.test(ragSrc));
check('rag no static embedClient', !/const embedClient = new OpenAI/.test(ragSrc));

const learnSrc = fs.readFileSync(path.join(__dirname, '../services/learningDb.js'), 'utf8');
check('learning uses failover', /openaiCreateWithProxyFailover/.test(learnSrc));
check('learning no scorerClient', !/scorerClient/.test(learnSrc));

const silSrc = fs.readFileSync(path.join(__dirname, '../services/silenceCatchup.js'), 'utf8');
check('CALL_ONLY_RE', /CALL_ONLY_RE/.test(silSrc));
check('beri trubku pattern', /бери\\s\+трубку/.test(silSrc));
check('healFailCooldown', /healFailCooldown/.test(silSrc));
check('HEAL_FAIL_COOLDOWN', /HEAL_FAIL_COOLDOWN_MS/.test(silSrc));

check('silence exports healOneGap', /healOneGap/.test(silSrc) && /module\.exports/.test(silSrc));

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_CONN_ERROR_FAILOVER_0LU_OK');
