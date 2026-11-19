#!/usr/bin/env node
/**
 * Hard audit 0m1 — wiring scaleIdeasPack + admin routes + FE.
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

const pack = read('services/scaleIdeasPack.js');
const gates = read('services/softHumanGates.js');
const lite = read('services/softHumanLite.js');
const nft = read('services/nftCampaign.js');
const admin = read('routes/adminConsole.js');
const fe = readRepo('frontend/app.js');
const html = readRepo('frontend/index.html');
const dash = read('routes/dashboard.js');

check('pack module', /applyWave0m1Gates/.test(pack), 'P0');
check('single voice mode', /abEnabled:\s*available\.length\s*>=\s*2/.test(pack), 'P0');
check('gates wave', /applyWave0m1Gates/.test(gates), 'P0');
check('lite wires wave', /applyWave0m1Gates/.test(lite), 'P0');
check('lite scale hints', /buildScaleHints/.test(lite), 'P0');
check('nft assign variant', /assignVoiceVariant/.test(nft), 'P0');
check('admin day-n', /\/scale\/day-n/.test(admin), 'P0');
check('admin errors', /\/scale\/errors/.test(admin), 'P0');
check('admin idea-day', /\/scale\/idea-day/.test(admin), 'P0');
check('admin csv', /\/scale\/metrics\.csv/.test(admin), 'P0');
check('creator gate', /fallonsociapat|isCreatorUser/.test(pack), 'P0');
check('dashboard isCreator', /isCreator/.test(dash), 'P0');
check('FE radar', /admin-radar-refresh|loadAdminRadar/.test(fe), 'P0');
check('FE idea day', /loadAdminIdeaDay|creator-only/.test(fe), 'P0');
check('FE health card', /a\.health|lastReplyAgeMin/.test(fe), 'P0');
check('HTML radar panel', /data-admin-panel="radar"/.test(html), 'P0');
check('HTML ideas panel', /data-admin-panel="ideas"/.test(html), 'P0');
check('updates v bump', /updates\.js\?v=258/.test(html), 'P0');
check('auth getUserId no 1', !/getUserId\s*=\s*1|telegram_user_id\s*\|\|\s*1/.test(admin), 'P0');

const smoke = path.join(__dirname, '_smoke_wave_0m1.js');
const r = spawnSync(process.execPath, [smoke], {
  encoding: 'utf8',
  timeout: 60_000,
  env: { ...process.env, OPENAI_API_KEY: 'sk-test' },
});
const out = `${r.stdout || ''}\n${r.stderr || ''}`;
check('smoke 0m1', /SMOKE_WAVE_0M1_OK/.test(out), 'P0', out.slice(-300));

if (p0 || p1) {
  console.error(`HARD_AUDIT_0M1_FAIL p0=${p0} p1=${p1}`);
  process.exit(1);
}
console.log('HARD_AUDIT_0M1_OK');
process.exit(0);
