#!/usr/bin/env node
/**
 * Hard audit 0fs/0fr: code wires, frontend B&W, updates sync, job/churn.
 * No OpenAI required for most checks.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const repo = path.join(root, '..');
let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.error('FAIL', name, detail || '');
  }
}
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const readB = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const css = read('frontend/styles.css');
const updates = read('frontend/updates.js');
const opsPath = path.join(repo, 'ops-console', 'app', 'updates.js');
const opsUp = fs.existsSync(opsPath) ? fs.readFileSync(opsPath, 'utf8') : '';
const index = read('frontend/index.html');
const job = readB('services/jobFlipAsk.js');
const churn = readB('services/churnLearn.js');
const peers = readB('services/peers.js');
const learn = readB('services/learningDb.js');
const ai = readB('services/aiResponder.js');

check('css B&W primary', /--primary:\s*#e8e8e8/.test(css));
check('css no pink hex', !/#e879c8|#c026d3|#f0abfc|#7c3aed/i.test(css));
check('css no purple rgb', !/rgba\(232,\s*121,\s*200|rgba\(168,\s*85,\s*247/.test(css));
check('index styles v69', /styles\.css\?v=69/.test(index));
check('index updates v99', /updates\.js\?v=99/.test(index));
check('updates has job flip', /слышал о таком/.test(updates));
check('updates has B&W entry', /Чёрно-белый|черно-белый/i.test(updates));
if (opsUp) {
  check('ops updates synced job', /слышал о таком/.test(opsUp));
  check('ops updates synced B&W', /Чёрно-белый|черно-белый/i.test(opsUp));
} else {
  check('ops updates optional on VPS (served via /updates.js)', true);
}
check('jobFlipAsk present', /ensureJobFlipHeardAsk/.test(job));
check('churnLearn present', /noteDialogGone/.test(churn));
check('peers wired churn', /churnLearn/.test(peers));
check('learning churn neg', /recordChurnNegative/.test(learn));
check('ai wires jobFlip', /ensureJobFlipHeardAsk/.test(ai));
check('DAY_ASK no занимаешься', !/DAY_ASK_RE[\s\S]{0,280}занимаешься/.test(ai));

// runtime
const jobFlip = require('../services/jobFlipAsk');
const churnM = require('../services/churnLearn');
check('runtime job ask', jobFlip.isJobOccupationAsk('кем работаешь?'));
check(
  'runtime ensure flip+heard',
  (() => {
    const o = jobFlip.ensureJobFlipHeardAsk('онлайн)', 'чем занимаешься?');
    return jobFlip.FLIP_MARK_RE.test(o) && jobFlip.HEARD_RE.test(o);
  })(),
);
check('runtime day clean', jobFlip.ensureJobFlipHeardAsk('кофе)', 'чем занята?') === 'кофе)');
check(
  'runtime churn nft',
  churnM.classifyChurnReason([{ role: 'assistant', content: 'флипаю токены)' }]) ===
    'after_nft_pitch',
);

console.log(fail ? `HARD_0FS_FAIL ${fail}` : 'HARD_0FS_OK');
process.exit(fail ? 1 : 0);
