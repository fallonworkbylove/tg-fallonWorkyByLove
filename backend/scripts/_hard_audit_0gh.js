#!/usr/bin/env node
/**
 * Hard audit 0gh: wiring 10 human ideas + regress musts.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.error('FAIL', name, detail || '');
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const ideas = read('services/humanIdeas10.js');
const pipe = read('services/replyPipeline.js');
const mem = read('services/memoryTriggers.js');
const hh = read('services/humanHardening.js');
const ops = read('services/opsQuality.js');
const life = read('services/lifeTexture.js');
const ai = read('services/aiResponder.js');
const he = read('services/humanExtra.js');
const job = read('services/jobFlipAsk.js');
const voice = read('services/voiceReplies.js');

check('ideas10 module exists', /maybeLifeLagMs/.test(ideas) && /stripCoffeeSeriesWalkCombo/.test(ideas));
check('pipe life-lag', /maybeLifeLagMs/.test(pipe));
check('pipe evening recall', /buildEveningRecallHint/.test(pipe));
check('mem hobby self-told', /type: 'hobby'/.test(mem));
check('mem strengthen ban', /strengthenSelfToldBan/.test(mem));
check('hh coffee strip', /stripCoffeeSeriesWalkCombo/.test(hh));
check('hh mild via ideas', /mildDisagreeHint/.test(hh));
check('ops silent bumped', /0\.52/.test(ops));
check('life forget once', /maybeForgetHintOnce/.test(life));
check('ai mood length', /applyMoodLengthBias/.test(ai));
check('he morning slept', /morningApologySleptHint|сорри спала/.test(he));
check('job day1 gate', /mayMentionFlipNft/.test(job));
check('voice repeat callout', /FLIP_VOICE_REPEAT_CALLOUT/.test(voice));
check('pipe dialogAgeHours', /dialogAgeHours/.test(pipe));

const frontend = fs.readFileSync(path.join(ROOT, '../frontend/updates.js'), 'utf8');
const index = fs.readFileSync(path.join(ROOT, '../frontend/index.html'), 'utf8');
check('miniapp updates 10 ideas or human', /человеч|иде|хобби|повтор|Флип|Десять/i.test(frontend));
check('updates v bump', /updates\.js\?v=\d+/.test(index));

if (fail) {
  console.error(`\n${fail} HARD AUDIT FAILS`);
  process.exit(1);
}
console.log('\nHARD_AUDIT_0GH_OK');
