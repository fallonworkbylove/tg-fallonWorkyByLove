/**
 * Smoke 0lp: bad-reply route wiring + login probe export + cron digest hooks.
 */
const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

const accountsSrc = fs.readFileSync(
  path.join(__dirname, '../routes/accounts.js'),
  'utf8',
);
assert(/bad-reply/.test(accountsSrc), 'accounts bad-reply route');
assert(/recordChurnNegative/.test(accountsSrc), 'uses learningDb');

const pools = require('../services/proxyPools');
assert(typeof pools.warmProbeLoginProxies === 'function', 'warmProbeLoginProxies');

const loginSrc = fs.readFileSync(
  path.join(__dirname, '../services/loginAuth.js'),
  'utf8',
);
assert(/warmProbeLoginProxies/.test(loginSrc), 'loginAuth probes before login');

const cronSrc = fs.readFileSync(path.join(__dirname, '_cron_audit_c.sh'), 'utf8');
assert(/sendAdminAlert/.test(cronSrc), 'cron sends digest');
assert(/Audit C nightly/.test(cronSrc), 'cron OK/FAIL title');

const appSrc = fs.readFileSync(
  path.join(__dirname, '../../frontend/app.js'),
  'utf8',
);
assert(/flagBadReply/.test(appSrc), 'frontend flagBadReply api');
assert(/data-action="bad-reply"/.test(appSrc), 'bad-reply buttons');
assert(/campaignArchive/.test(appSrc), 'NFT archive cards');

console.log('OK wave_0lp');
process.exit(0);
