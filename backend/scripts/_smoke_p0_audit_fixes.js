/**
 * Smoke: P0 audit fixes (no Telegram/DB required for most checks).
 */
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const fs = require('fs');
const path = require('path');

// Reuse OPS parser via vm-free copy — load main.js helpers by requiring file fragment.
// Inline minimal test of updates parse through ops-console logic:
const opsMainPath = path.join(__dirname, '../../ops-console/main.js');
const opsSrc = fs.readFileSync(opsMainPath, 'utf8');
assert(!/runInNewContext/.test(opsSrc), 'no vm');
assert(/ALLOWED_BASE_HOSTS/.test(opsSrc), 'allowlist');
assert(/jsLiteralToJson/.test(opsSrc), 'js literal converter');

// Extract and eval ONLY the pure helper functions from main.js for smoke
// (no electron). Copy helpers into Function scope.
const helpersMatch = opsSrc.match(
  /function extractBalancedArray[\s\S]*?function parseUpdatesList[\s\S]*?return list\.map\([\s\S]*?\);\n\}/,
);
assert(helpersMatch, 'helpers present');
const parseUpdatesList = new Function(
  `${helpersMatch[0]}; return parseUpdatesList;`,
)();

const updatesPath = path.join(__dirname, '../../frontend/updates.js');
const list = parseUpdatesList(fs.readFileSync(updatesPath, 'utf8'));
assert(list.length > 5, 'updates list');
assert(list[0].title, 'first title');
console.log('ok updates parse', list.length, list[0].title);

const access = require('../services/operatorAccess');
assert(!access.isSuperAdmin(null, 'fallonsociapat'), 'no username superadmin');
assert(!access.isSuperAdmin('999', 'fallonsociapat'), 'wrong id');
console.log('ok superadmin id-only');

const adminOpsSrc = fs.readFileSync(path.join(__dirname, '../services/adminOps.js'), 'utf8');
assert(/result\?\.status === 'needPassword'/.test(adminOpsSrc), 'needPassword status');
assert(!/result\?\.needPassword\b/.test(adminOpsSrc), 'old field gone');
console.log('ok ops 2FA');

const loginAuth = require('../services/loginAuth');
assert(typeof loginAuth.releaseLoginHandoff === 'function', 'handoff');
assert(loginAuth.qrImageUrl('x') == null, 'qr stub');
console.log('ok loginAuth');

const pool = require('../services/clientPool');
pool.markFreshSession(424242, 'abcSESSIONTEST');
assert(pool.isFreshSessionProtected(424242, 'abcSESSIONTEST'), 'grace');
console.log('ok fresh grace');

const debugSrc = fs.readFileSync(path.join(__dirname, '../middleware/debugUser.js'), 'utf8');
assert(/NODE_ENV === 'development'/.test(debugSrc), 'debug gated');
console.log('ok debugUser');

const deploy1 = fs.readFileSync(path.join(__dirname, '_deploy_audit_fixes.sh'), 'utf8');
assert(!/echo 'TELEGRAM_AUTH_BYPASS_FORCE=true'/.test(deploy1), 'no force bypass append');
console.log('ok deploy no FORCE');

console.log('P0_AUDIT_SMOKE OK');
