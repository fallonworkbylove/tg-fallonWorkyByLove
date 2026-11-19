#!/usr/bin/env node
/**
 * Hard audit 0lz — FE≠OPS, openai failover, waiting/operator, security gates.
 */
'use strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-audit';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const repo = path.join(root, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const readRepo = (p) => fs.readFileSync(path.join(repo, p), 'utf8');

let p0 = 0;
let p1 = 0;
function ok(name) {
  console.log('OK', name);
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

console.log('=== HARD AUDIT 0lz ===');

const feIdx = readRepo('frontend/index.html');
const guard = read('scripts/_deploy_guard.sh');
const opsQ = read('services/opsQuality.js');
const sil = read('services/silenceCatchup.js');
const ai = read('services/aiResponder.js');
const server = read('server.js');
const getUserId = read('lib/getUserId.js');
const auth = read('middleware/telegramAuth.js');
const cl = readRepo('CHANGELOG_TG.md');
const feUp = readRepo('frontend/updates.js');
const opsUp = readRepo('ops-console/app/updates.js');

check('FE≠OPS', !/операторская,\s*вне Telegram/.test(feIdx) && /app-splash/.test(feIdx), 'P0');
check('guard FE≠OPS', /REFUSE_FRONTEND_IS_OPS/.test(guard), 'P0');
check('guard PROXY≥5', /REFUSE_PROXY/.test(guard), 'P0');
check('guard openai key', /REFUSE_OPENAI_FAKE_KEY/.test(guard), 'P0');
check('conn error failover', /Connection error/.test(ai) && /APIConnectionError/.test(ai), 'P0');
check('skip dead TTL', /12\s*\*\s*60\s*\*\s*1000/.test(ai), 'P1');
check('waiting work/night', /isWithinGlobalWorkingHours/.test(opsQ) && /isNightTextQuietHour/.test(opsQ), 'P0');
check('waiting/silence skip operator', /NOT IN \('filtered','operator'\)/.test(opsQ) && /NOT IN \('filtered','operator'\)/.test(sil), 'P0');
check('cors not *', !/origin:\s*true/.test(server) && !/origin:\s*['"]\*['"]/.test(server), 'P0');
check('getUserId no fallback 1', !/\breturn\s+1\b/.test(getUserId) && /401/.test(getUserId), 'P0');
check('bypass force loopback', /TELEGRAM_AUTH_BYPASS_FORCE/.test(auth) && /isLoopback|loopback/i.test(auth), 'P0');
check('changelog 0lz', /^## 0lz\./m.test(cl), 'P0');
check('dual updates 0lz', /Ждут ответа без ручных/.test(feUp) && /Ждут ответа без ручных/.test(opsUp), 'P0');
check('updates v≥256', /updates\.js\?v=(2[5-9]\d|[3-9]\d{2,})/.test(feIdx), 'P0');

const smoke = path.join(__dirname, '_smoke_project_harden_0lz.js');
const r = spawnSync(process.execPath, [smoke], {
  env: { ...process.env, OPENAI_API_KEY: 'sk-test' },
  encoding: 'utf8',
  timeout: 60_000,
  stdio: ['ignore', 'pipe', 'pipe'],
});
check('smoke harden 0lz', r.status === 0 && /SMOKE_PROJECT_HARDEN_0LZ_OK/.test(r.stdout || ''), 'P0', (r.stdout || r.stderr || '').slice(-200));

if (p0 || p1) {
  console.error(`HARD_AUDIT_0LZ_FAIL p0=${p0} p1=${p1}`);
  process.exit(1);
}
console.log('HARD_AUDIT_0LZ_OK');
process.exit(0);
