#!/usr/bin/env node
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

const ai = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
check('skip dead helper', /isOpenAiSocksMarkedDead/.test(ai));
check('prefer liveIdx', /liveIdx\.length \? liveIdx : deadIdx/.test(ai));
check('no 60s openai dead ttl', !/openai transport',\s*60_000/.test(ai));
check('markProxyDeadByHost default ttl', /markProxyDeadByHost\(\s*socks\.host,\s*socks\.port,\s*err\.message/.test(ai));
check('Connection error still transport', /Connection error/.test(ai));

delete require.cache[require.resolve('../services/proxyPools')];
const pp = require('../services/proxyPools');
check('Connection error. transport', pp.isProxyTransportError(new Error('Connection error.')));

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_OPENAI_SKIP_DEAD_0LV_OK');
