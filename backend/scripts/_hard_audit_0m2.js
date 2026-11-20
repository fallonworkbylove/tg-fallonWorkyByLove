#!/usr/bin/env node
/**
 * Hard audit 0m2 — gate registry, live cliche, mac-ship auto, secrets hygiene.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const repo = path.join(root, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const readRepo = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');

let p0 = 0;
let p1 = 0;
function ok(name, detail) {
  console.log('OK ', name, detail || '');
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

const reg = read('services/replyGateRegistry.js');
const lite = read('services/softHumanLite.js');
const live = read('services/opsLiveMetrics.js');
const ship = readRepo('scripts/mac-ship.sh');
const gi = readRepo('.gitignore');
const html = readRepo('frontend/index.html');
const cl = readRepo('CHANGELOG_TG.md');
const feUp = readRepo('frontend/updates.js');
const opsUp = readRepo('ops-console/app/updates.js');

check('registry module', /fixLiveClicheOveruse|listWaves|applyRegisteredGates/.test(reg), 'P0');
check('lite wires registry', /replyGateRegistry/.test(lite) && /fixLiveClicheOveruse/.test(lite), 'P0');
check('live exports CLICHE_TRACK', /CLICHE_TRACK/.test(live) && /module\.exports[\s\S]*CLICHE_TRACK/.test(live), 'P0');
check('mac-ship auto SRC', /MAC_SHIP_DEPLOY_SH/.test(ship) && /MAC_SHIP_NO_AUTO/.test(ship), 'P0');
check('gitignore private ssh', /secrets\/ssh\/id_ed25519/.test(gi), 'P0');
check('updates v bump', /updates\.js\?v=259/.test(html), 'P0');
check('changelog 0m2', /## 0m2\./.test(cl), 'P0');
check('FE updates 0m2 title', /Меньше клише|автовыкат|Живее без клише/i.test(feUp), 'P0');
check('OPS updates sync', /Меньше клише|автовыкат|Живее без клише/i.test(opsUp), 'P0');
check('auth getUserId no 1', !/getUserId\s*=\s*1|telegram_user_id\s*\|\|\s*1/.test(read('routes/adminConsole.js')), 'P0');

const smoke = path.join(__dirname, '_smoke_wave_0m2.js');
const r = spawnSync(process.execPath, [smoke], {
  encoding: 'utf8',
  timeout: 60_000,
  env: { ...process.env, OPENAI_API_KEY: 'sk-test' },
});
const out = `${r.stdout || ''}\n${r.stderr || ''}`;
check('smoke 0m2', /SMOKE_WAVE_0M2_OK/.test(out), 'P0', out.slice(-400));

const smoke1 = path.join(__dirname, '_smoke_wave_0m1.js');
if (fs.existsSync(smoke1)) {
  const r1 = spawnSync(process.execPath, [smoke1], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, OPENAI_API_KEY: 'sk-test' },
  });
  const o1 = `${r1.stdout || ''}\n${r1.stderr || ''}`;
  check('smoke 0m1 regress', /SMOKE_WAVE_0M1_OK/.test(o1), 'P0', o1.slice(-300));
}

if (p0 || p1) {
  console.error(`HARD_AUDIT_0M2_FAIL p0=${p0} p1=${p1}`);
  process.exit(1);
}
console.log('HARD_AUDIT_0M2_OK');
process.exit(0);
