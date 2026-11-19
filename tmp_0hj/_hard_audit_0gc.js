#!/usr/bin/env node
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const services = path.join(ROOT, 'services');
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) console.log(`OK  ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(services, rel), 'utf8');
}

const oq = read('opsQuality.js');
const pipe = read('replyPipeline.js');
const lead = read('leadScoring.js');
const oh = read('objectionHandler.js');
const mem = read('memoryTriggers.js');
const hh = read('humanHardening.js');
const media = read('mediaSend.js');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const help = read('helpRequestNotifier.js');

check('opsQuality module', /formatFilterNote|tempoForLeadTier|preferSilentReaction|mediaTimeSlot|runAiSilenceWatch|startOpsQualitySchedulers/.test(oq));
check('HOWLONG still 21', /HOWLONG_ARCHIVE_DAYS\s*=\s*21/.test(read('howLong.js')));
check('pipe markPeerFiltered howlong', /formatFilterNote\('howlong'/.test(pipe));
check('pipe tempo delay', /applyTempoDelay/.test(pipe));
check('pipe allowProactiveMedia', /allowProactiveMedia/.test(pipe));
check('pipe silent react tier', /preferReactionOnlyOnBareOk\([\s\S]*leadTier/.test(pipe));
check('silent→filtered', /formatFilterNote\('silent'/.test(oh));
check('manual filter note', /formatFilterNote\('manual'/.test(lead));
check('memory КАРТОЧКА', /КАРТОЧКА собеседника/.test(mem));
check('phrase ban ≤3', /return 1[\s\S]*return 2[\s\S]*return 3/.test(hh));
check('media slot policy', /mediaSlotPolicy|sortMediaBySlotPrefer/.test(media));
check('server start opsQuality', /startOpsQualitySchedulers/.test(server));
check('sendAdminAlert exported', /sendAdminAlert,/.test(help));

const fe = path.join(ROOT, '..', 'frontend');
const updates = fs.readFileSync(path.join(fe, 'updates.js'), 'utf8');
const index = fs.readFileSync(path.join(fe, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(fe, 'app.js'), 'utf8');
const cl = fs.readFileSync(path.join(ROOT, '..', 'CHANGELOG_TG.md'), 'utf8');
const ver = Number((index.match(/updates\.js\?v=(\d+)/) || [])[1] || 0);
check('updates.js?v >= 108', ver >= 108, `got ${ver}`);
check('CHANGELOG 0gc', /## 0gc\./.test(cl));
check(
  'updates entry',
  /Ночью не пишет|Меньше пустых|тишин|отсев|причин|реакц|догоняет/i.test(updates.slice(0, 3500)),
);
check('UI operator_note', /operatorNote|operator_note/.test(app) && /lesson-item__note/.test(app));

const skillDeploy = path.join(ROOT, '..', '.cursor', 'skills', 'loverussian-deploy', 'SKILL.md');
const skillAudit = path.join(ROOT, '..', '.cursor', 'skills', 'loverussian-human-audit', 'SKILL.md');
check('skill deploy', fs.existsSync(skillDeploy));
check('skill human-audit', fs.existsSync(skillAudit));

const smoke = spawnSync(process.execPath, [path.join(__dirname, '_smoke_ops_quality.js')], {
  env: { ...process.env, OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'sk-test' },
  encoding: 'utf8',
});
check('smoke opsQuality', smoke.status === 0, (smoke.stderr || smoke.stdout || '').slice(-200));

const howSmoke = spawnSync(process.execPath, [path.join(__dirname, '_smoke_howlong_parse.js')], {
  env: { ...process.env, OPENAI_API_KEY: 'sk-test' },
  encoding: 'utf8',
});
check('smoke howlong', howSmoke.status === 0, (howSmoke.stderr || howSmoke.stdout || '').slice(-200));

if (failed) {
  console.error(`HARD_AUDIT_0GC_FAIL ${failed}`);
  process.exit(1);
}
console.log('HARD_AUDIT_0GC_OK');
