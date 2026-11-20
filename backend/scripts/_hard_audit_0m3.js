#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repo = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');

let p0 = 0;
let p1 = 0;
function ok(name) {
  console.log('OK ', name);
}
function fail(lvl, name, detail) {
  if (lvl === 'P0') p0 += 1;
  else p1 += 1;
  console.log(lvl, name, detail || '');
}
function check(name, cond, lvl, detail) {
  if (cond) ok(name);
  else fail(lvl || 'P1', name, detail);
}

const app = read('frontend/app.js');
const html = read('frontend/index.html');
const css = read('frontend/styles.css');
const cl = read('CHANGELOG_TG.md');
const fe = read('frontend/updates.js');
const ops = read('ops-console/app/updates.js');

check('owner open', /openAdminOwnerPool/.test(app), 'P0');
check('owner filter', /setAdminOwnerFilter/.test(app) && /admin-owner-clear/.test(app), 'P0');
check('hidden css', /admin-block\[hidden\]/.test(css), 'P0');
check('distinct panels', /admin-panel--activity/.test(html) && /admin-panel--radar/.test(html), 'P0');
check('changelog 0m3', /## 0m3\./.test(cl), 'P0');
check('FE updates', /Владелец пула|События ≠ радар/i.test(fe), 'P0');
check('OPS updates', /Владелец пула|События ≠ радар/i.test(ops), 'P0');
check('v bump', /updates\.js\?v=260/.test(html), 'P0');

const smoke = path.join(__dirname, '_smoke_admin_owner_0m3.js');
const r = spawnSync(process.execPath, [smoke], { encoding: 'utf8', timeout: 30_000 });
const out = `${r.stdout || ''}\n${r.stderr || ''}`;
check('smoke 0m3', /SMOKE_ADMIN_OWNER_0M3_OK/.test(out), 'P0', out.slice(-200));

if (p0 || p1) {
  console.error(`HARD_AUDIT_0M3_FAIL p0=${p0} p1=${p1}`);
  process.exit(1);
}
console.log('HARD_AUDIT_0M3_OK');
process.exit(0);
