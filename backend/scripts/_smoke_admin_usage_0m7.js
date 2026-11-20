/**
 * Smoke 0m7 — формат возраста ответа + per-account usage wiring.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

const root = path.join(__dirname, '../..');
const appSrc = fs.readFileSync(path.join(root, 'frontend/app.js'), 'utf8');
const usageSrc = fs.readFileSync(path.join(root, 'backend/services/finetuneUsage.js'), 'utf8');
const statsSrc = fs.readFileSync(path.join(root, 'backend/services/adminConsoleStats.js'), 'utf8');
const aiSrc = fs.readFileSync(path.join(root, 'backend/services/aiResponder.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');

assert(/function formatAdminReplyAge/.test(appSrc), 'formatAdminReplyAge');
assert(/function formatAdminTokens/.test(appSrc), 'formatAdminTokens');
assert(/tokensToday|tokensAll/.test(appSrc), 'tokens on card');
assert(/getAccountCostMap/.test(usageSrc) && /account_id/.test(usageSrc), 'usage account_id');
assert(/getAccountCostMap/.test(statsSrc) && /tokensAll/.test(statsSrc), 'stats wiring');
assert(/accountId:\s*options\.accountId/.test(aiSrc), 'aiResponder passes accountId');

// Extract and run format helpers in isolation
const start = appSrc.indexOf('function formatAdminReplyAge');
const end = appSrc.indexOf('function formatAdminCostUsd');
const end2 = appSrc.indexOf('\n}', end) + 2;
const chunk = appSrc.slice(start, end2);
const sandbox = {};
vm.runInNewContext(`${chunk}\nthis.formatAdminReplyAge=formatAdminReplyAge;this.formatAdminTokens=formatAdminTokens;this.formatAdminCostUsd=formatAdminCostUsd;`, sandbox);

assert(sandbox.formatAdminReplyAge(45) === '45 мин', '45 min');
assert(sandbox.formatAdminReplyAge(70) === '1 ч 10 мин', '70 -> 1h10');
assert(sandbox.formatAdminReplyAge(60) === '1 ч', '60 -> 1h');
assert(sandbox.formatAdminReplyAge(138) === '2 ч 18 мин', '138');
assert(sandbox.formatAdminReplyAge(1500) === '1 д 1 ч', '1500');
assert(sandbox.formatAdminReplyAge(null) === '—', 'null');
assert(sandbox.formatAdminTokens(12500) === '13k' || sandbox.formatAdminTokens(12500) === '12.5k', 'tokens k');
assert(String(sandbox.formatAdminCostUsd(0.003)).includes('0.003'), 'cost');

assert(/updates\.js\?v=264/.test(html) && /app\.js\?v=189/.test(html), 'bumps');
console.log('SMOKE_ADMIN_USAGE_0M7_OK');
process.exit(0);
