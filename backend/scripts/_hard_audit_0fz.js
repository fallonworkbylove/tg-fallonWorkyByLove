#!/usr/bin/env node
/**
 * Hard audit 0fz — Must/Should/Nice humanHardening + prior 0fx gates.
 * Static + runtime smoke. Exit 1 on any fail.
 */
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const services = path.join(ROOT, 'services');
let failed = 0;
const findings = [];

function check(name, ok, detail = '') {
  if (ok) console.log(`OK  ${name}`);
  else {
    failed += 1;
    const msg = detail ? `${name}: ${detail}` : name;
    findings.push(msg);
    console.error(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(services, rel), 'utf8');
}

const hh = read('humanHardening.js');
const voice = read('voiceReplies.js');
const objection = read('objectionHandler.js');
const nft = read('nftCampaign.js');
const pipe = read('replyPipeline.js');
const ai = read('aiResponder.js');
const daily = read('dailyPhotos.js');
const soft = read('softHumanLite.js');

// --- module presence ---
check('humanHardening exists', fs.existsSync(path.join(services, 'humanHardening.js')));
check('CLONE_SKEPTIC_RE', /CLONE_SKEPTIC_RE/.test(hh));
check('shouldBlockNftPitch', /function shouldBlockNftPitch/.test(hh));
check('applyHardeningPostfilters', /function applyHardeningPostfilters/.test(hh));
check('phrase ban', /isPhraseBanned|registerOutgoing/.test(hh));
check('peerTier', /function peerTier/.test(hh));
check('diary', /ensureDiary|getDiaryHint/.test(hh));
check('deferred media', /scheduleDeferredMedia|takeDueDeferredMedia/.test(hh));
check('bare ok', /preferReactionOnlyOnBareOk/.test(hh));
check('media after pitch', /shouldBlockMediaAfterPitch/.test(hh));
check('strip поняла/hah', /stripRepeatPonialaHah/.test(hh));
check('strip self intro', /stripRepeatSelfIntro/.test(hh));
check('strip appearance', /stripAppearanceOnForeign/.test(hh));
check('template detector', /looksTemplated/.test(hh));
check('human score', /computeHumanScore/.test(hh));
check('no db require (mem-only)', !/require\('\.\.\/db'\)/.test(hh));

// --- wiring ---
check('objection clone early', /getCloneSkepticHint/.test(objection));
check('nft suppress uses hardening', /humanHardening/.test(nft) && /shouldBlockNftPitch/.test(nft));
check('nft suppress accountId peerId', /accountId\s*=\s*null/.test(nft) && /peerId\s*=\s*null/.test(nft));
check('voice hostile returns null early', /FLIP_VOICE_HOSTILE_RE\.test\(normalized\)\)\s*return null/.test(voice));
check('findTextReply uses textForVoiceMatch', /textForVoiceMatch\(text\)/.test(voice));
check('aiResponder postfilter', /applyHardeningPostfilters/.test(ai));
check('pipeline require', /require\('\.\/humanHardening'\)/.test(pipe));
check('pipeline suppress with accountId', /accountId,\s*\n\s*peerId/.test(pipe) || /accountId,\s*peerId/.test(pipe));
check('pipeline hardening hints', /buildHardeningHints/.test(pipe));
check('pipeline bare ok', /preferReactionOnlyOnBareOk/.test(pipe));
check('pipeline media after pitch', /shouldBlockMediaAfterPitch/.test(pipe));
check('pipeline notePitchSent', /notePitchSent/.test(pipe));
check('pipeline deferred promise', /detectDeferredMediaPromise/.test(pipe));
check('dailyPhotos noteFlip', /noteFlipPhotoSent/.test(daily));
check('softLite still intact', /function applySoftLite/.test(soft) && /breakKaifEcho/.test(soft));

// --- prior 0fx regressions ---
check('quiet hours &&', (() => {
  const timing = read('timing.js');
  return /VOICE_QUIET[\s\S]{0,200}&&|hour\s*>=\s*VOICE_QUIET_START[\s\S]{0,40}&&/.test(timing) ||
    />=\s*VOICE_QUIET_START_HOUR\s*&&\s*hour\s*<\s*VOICE_QUIET_END_HOUR/.test(timing);
})());
check('VOICE_REPEAT_GAP_MS defined', /const VOICE_REPEAT_GAP_MS\s*=/.test(pipe));
check('lastIncomingText import/use', /lastIncomingText/.test(pipe));
check('softenFlipPhotoIdentity', /softenFlipPhotoIdentityReply/.test(objection));
check('textForVoiceMatch fn', /function textForVoiceMatch/.test(voice));

// --- frontend / changelog ---
const fe = path.join(ROOT, '..', 'frontend');
const updates = fs.readFileSync(path.join(fe, 'updates.js'), 'utf8');
const index = fs.readFileSync(path.join(fe, 'index.html'), 'utf8');
const cl = fs.readFileSync(path.join(ROOT, '..', 'CHANGELOG_TG.md'), 'utf8');
const vMatch = index.match(/updates\.js\?v=(\d+)/);
const ver = vMatch ? Number(vMatch[1]) : 0;
check('updates.js?v >= 105', ver >= 105, `got ${ver}`);
check('CHANGELOG 0fz', /## 0fz\./.test(cl));
check('updates has hardening entry', /жив|скепсис|одинаков|предложка|человечн/i.test(updates.slice(0, 2500)));

// --- runtime ---
console.log('\n--- runtime smoke ---');
{
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [path.join(__dirname, '_smoke_human_hardening.js')], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
  });
  const ok = r.status === 0 && /ALL PASS/.test(r.stdout || '');
  check('runtime smoke exit', ok, ok ? '' : (r.stderr || r.stdout || '').slice(-400));
}

// --- syntax load ---
for (const mod of [
  'humanHardening',
  'voiceReplies',
  'objectionHandler',
  'nftCampaign',
]) {
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
console.log('HARD AUDIT 0fz PASS');
process.exit(0);
