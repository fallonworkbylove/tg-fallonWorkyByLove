#!/usr/bin/env node
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

process.env.PROXY_LIST =
  'socks5:1.1.1.1:8000:u:p;socks5:2.2.2.2:8000:u:p;socks5:3.3.3.3:8000:u:p';

// Reload module with test PROXY_LIST — require after env set.
delete require.cache[require.resolve('../services/proxyPools')];
const pp = require('../services/proxyPools');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

check('pool len', pp.PROXY_POOL.length === 3, pp.PROXY_POOL.length);

const before = pp.getCurrentProxyIndex();
pp.markProxyDead(0, 'smoke timeout');
check('marked dead', pp.isProxyDead(pp.PROXY_POOL[0]));
check('switched away', pp.getCurrentProxyIndex() !== 0 || before !== 0, pp.getCurrentProxyIndex());

const cands = pp.connectionCandidates();
check('live first', cands[0] && cands[0].index !== 0, cands[0] && cands[0].index);

check('transport detect', pp.isProxyTransportError(new Error('Proxy connection timed out')));
check('not transport', !pp.isProxyTransportError(new Error('AUTH_KEY_UNREGISTERED')));

const src = require('fs').readFileSync(
  require('path').join(__dirname, '../services/clientPool.js'),
  'utf8',
);
check('clientPool marks dead', /markProxyDead/.test(src));
const ai = require('fs').readFileSync(
  require('path').join(__dirname, '../services/aiResponder.js'),
  'utf8',
);
check('openai failover', /openaiCreateWithProxyFailover/.test(ai));

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_PROXY_FAILOVER_0GM_OK');
