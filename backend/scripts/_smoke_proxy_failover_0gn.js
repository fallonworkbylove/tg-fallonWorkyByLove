#!/usr/bin/env node
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

process.env.PROXY_LIST =
  'socks5:1.1.1.1:8000:u:p;socks5:2.2.2.2:8000:u:p;socks5:3.3.3.3:8000:u:p';

delete require.cache[require.resolve('../services/proxyPools')];
const pp = require('../services/proxyPools');
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

check('pool len', pp.PROXY_POOL.length === 3, pp.PROXY_POOL.length);

pp.markProxyDead(0, 'smoke timeout');
check('marked dead', pp.isProxyDead(pp.PROXY_POOL[0]));
check('switched away', pp.getCurrentProxyIndex() !== 0, pp.getCurrentProxyIndex());

const cands = pp.connectionCandidates();
check('live first', cands[0] && cands[0].index !== 0, cands[0] && cands[0].index);
check(
  'retries 1',
  cands[0] && cands[0].opts && cands[0].opts.connectionRetries === 1,
  cands[0] && cands[0].opts && cands[0].opts.connectionRetries,
);
check(
  'false connect detect',
  pp.isProxyTransportError(new Error('Proxy connection failed')),
);

check('transport detect', pp.isProxyTransportError(new Error('Proxy connection timed out')));
check('deadline detect', pp.isProxyTransportError(new Error('Proxy connection timed out (deadline)')));
check('not transport', !pp.isProxyTransportError(new Error('AUTH_KEY_UNREGISTERED')));
check('warm export', typeof pp.warmProbeWorkProxies === 'function');
check('hook export', typeof pp.installSocksDeadHook === 'function');
check('tgWeak export', typeof pp.isTgWeak === 'function');
check('candidates after dead', pp.connectionCandidates().length >= 1);

const clientSrc = fs.readFileSync(path.join(__dirname, '../services/clientPool.js'), 'utf8');
check('deadline connect', /connectWithDeadline/.test(clientSrc));
check('clientPool marks dead', /markProxyDead/.test(clientSrc));

const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
check('server warm probe', /warmProbeWorkProxies/.test(serverSrc));

const ai = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
check('openai failover', /openaiCreateWithProxyFailover/.test(ai));

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_PROXY_FAILOVER_0GN_OK');
