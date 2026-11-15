#!/usr/bin/env node
/**
 * Smoke 0ju: leads show work-account name/username above phone.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const leadSrc = fs.readFileSync(path.join(root, 'services/leadScoring.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, '../frontend/app.js'), 'utf8');

let failed = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log(`OK ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

ok(
  'leadScoring_selects_prompt',
  /MAX\(a\.prompt\)\s+AS\s+account_prompt/.test(leadSrc),
);
ok(
  'leadScoring_emits_account_name',
  /account_name:\s*accountName/.test(leadSrc) && /account_username:/.test(leadSrc),
);
ok(
  'leadScoring_uses_username_or_prompt',
  /getAccountUsernameSync/.test(leadSrc) && /nameFromPrompt/.test(leadSrc),
);
ok(
  'frontend_acc_name_line',
  /lesson-item__acc-name/.test(appSrc) && /formatAccountTitle\(workAcc\)/.test(appSrc),
);
ok(
  'frontend_above_account_phone',
  /lesson-item__acc-name[\s\S]{0,200}<strong>Аккаунт:<\/strong>/.test(appSrc),
);

if (failed) {
  console.error(`FAIL count=${failed}`);
  process.exit(1);
}
console.log('OK all');
