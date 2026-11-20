#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const repo = path.join(__dirname, '../..');
const read = (r) => fs.readFileSync(path.join(repo, r), 'utf8');
let p0 = 0;
function check(name, cond, detail) {
  if (cond) console.log('OK ', name);
  else {
    p0 += 1;
    console.log('P0', name, detail || '');
  }
}
check('usage account_id', /account_id/.test(read('backend/services/finetuneUsage.js')));
check('getAccountCostMap', /getAccountCostMap/.test(read('backend/services/finetuneUsage.js')));
check('stats tokensAll', /tokensAll/.test(read('backend/services/adminConsoleStats.js')));
check('format age', /formatAdminReplyAge/.test(read('frontend/app.js')));
check('changelog', /## 0m7\./.test(read('CHANGELOG_TG.md')));
check('FE updates', /Токены на карточке|час и мин|ответ.*ч/i.test(read('frontend/updates.js')));
const r = spawnSync(process.execPath, [path.join(__dirname, '_smoke_admin_usage_0m7.js')], {
  encoding: 'utf8',
  timeout: 30_000,
});
const out = `${r.stdout || ''}\n${r.stderr || ''}`;
check('smoke', /SMOKE_ADMIN_USAGE_0M7_OK/.test(out), out.slice(-200));
if (p0) {
  console.error('HARD_AUDIT_0M7_FAIL');
  process.exit(1);
}
console.log('HARD_AUDIT_0M7_OK');
process.exit(0);
