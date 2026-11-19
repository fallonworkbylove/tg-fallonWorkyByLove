#!/usr/bin/env node
/**
 * Hard audit 0ga — full stack: prior 0fz + new A/B/C ideas.
 */
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const services = path.join(ROOT, 'services');
let failed = 0;
const findings = [];

function check(name, ok, detail = '') {
  if (ok) console.log(`OK  ${name}`);
  else {
    failed += 1;
    findings.push(detail ? `${name}: ${detail}` : name);
    console.error(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(services, rel), 'utf8');
}

const hh = read('humanHardening.js');
const oh = read('objectionHandler.js');
const pipe = read('replyPipeline.js');
const inbound = read('inbound.js');
const scan = read('scanCatchup.js');
const mem = read('memoryTriggers.js');
const timing = read('timing.js');
const voice = read('voiceReplies.js');
const nft = read('nftCampaign.js');
const ai = read('aiResponder.js');

// --- 0fz baseline ---
check('hh module', /CLONE_SKEPTIC_RE/.test(hh) && /shouldBlockNftPitch/.test(hh));
check('quiet &&', />=\s*VOICE_QUIET_START_HOUR\s*&&\s*hour\s*<\s*VOICE_QUIET_END_HOUR/.test(timing));
check('voice hostile null', /FLIP_VOICE_HOSTILE_RE\.test\(normalized\)\)\s*return null/.test(voice));
check('nft suppress hardening', /shouldBlockNftPitch/.test(nft));
check('ai postfilter', /applyHardeningPostfilters/.test(ai));

// --- 0ga new ---
check('#72 BOT_TEST_RE', /BOT_TEST_RE/.test(hh));
check('#73 CAPTCHA_TEST_RE', /CAPTCHA_TEST_RE/.test(hh));
check('#72/#73 detectHint', /getBotTestHint/.test(oh));
check('#48 stripAnketa', /stripAnketaTone/.test(hh));
check('#49 stripLists', /stripChatLists/.test(hh));
check('#14 deferred text', /scheduleDeferredText|detectLaterTextPromise/.test(hh));
check('#14 inbound schedule', /scheduleLaterTextReturn/.test(inbound));
check('#14 pipe wire', /scheduleLaterTextReturn/.test(pipe) && /cancelDeferredText/.test(pipe));
check('#84 aggregate wider', /AGGREGATE_WINDOW_MS\s*=\s*3200/.test(inbound));
check('#84 burst hint', /getBurstReplyHint/.test(hh) && /getBurstReplyHint/.test(pipe));
check('#75 dislike ban', /НЕ ПРЕДЛАГАЙ/.test(mem));
check('#95 catch-up skip', /Catch-up skip: поздний/.test(scan) && /getWorkZoneHour/.test(scan));
check('#96 logOutboundReason', /logOutboundReason/.test(hh) && /logOutboundReason/.test(pipe));
check('#100 tighten', /shouldTightenFilters/.test(hh) && /phraseBanLimitFor/.test(hh));
check('#100 in nft block', /shouldTightenFilters\(accountId\)/.test(hh));

// frontend
const fe = path.join(ROOT, '..', 'frontend');
const updates = fs.readFileSync(path.join(fe, 'updates.js'), 'utf8');
const index = fs.readFileSync(path.join(fe, 'index.html'), 'utf8');
const cl = fs.readFileSync(path.join(ROOT, '..', 'CHANGELOG_TG.md'), 'utf8');
const ver = Number((index.match(/updates\.js\?v=(\d+)/) || [])[1] || 0);
check('updates.js?v >= 106', ver >= 106, `got ${ver}`);
check('CHANGELOG 0ga', /## 0ga\./.test(cl));
check('updates entry', /тест|капч|списк|позже|догон|шаблон/i.test(updates.slice(0, 2800)));

const opsPath = path.join(ROOT, '..', 'ops-console', 'app', 'updates.js');
if (fs.existsSync(opsPath)) {
  check(
    'ops-console updates synced',
    /тест|капч|списк|Антитесты|Живее/i.test(fs.readFileSync(opsPath, 'utf8').slice(0, 3000)),
  );
} else {
  // На VPS ops-console нет — лента только miniapp/frontend (nginx root).
  check('ops-console absent (miniapp-only OK)', true);
}

console.log('\n--- smoke 0fz ---');
{
  const r = spawnSync(process.execPath, [path.join(__dirname, '_smoke_human_hardening.js')], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
  });
  check('smoke 0fz', r.status === 0 && /ALL PASS/.test(r.stdout || ''), (r.stderr || r.stdout || '').slice(-300));
}
console.log('\n--- smoke 0ga ---');
{
  const r = spawnSync(process.execPath, [path.join(__dirname, '_smoke_human_0ga.js')], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
  });
  check('smoke 0ga', r.status === 0 && /ALL PASS/.test(r.stdout || ''), (r.stderr || r.stdout || '').slice(-300));
}

for (const mod of ['humanHardening', 'inbound', 'scanCatchup', 'memoryTriggers']) {
  try {
    require(path.join(services, mod));
    check(`require ${mod}`, true);
  } catch (e) {
    check(`require ${mod}`, false, e.message);
  }
}

console.log('\n==== SUMMARY ====');
if (failed) {
  console.error(`${failed} FAIL(s):`);
  findings.forEach((f) => console.error(' -', f));
  process.exit(1);
}
console.log('HARD AUDIT 0ga PASS');
process.exit(0);
