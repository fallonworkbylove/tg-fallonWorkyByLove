#!/usr/bin/env node
/**
 * Жёсткий аудит 0fr: job-flip + churn classify + wire presence.
 */
const fs = require('fs');
const path = require('path');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.error('FAIL', name, detail || '');
  }
}

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const jobSrc = read('services/jobFlipAsk.js');
const churnSrc = read('services/churnLearn.js');
const aiSrc = read('services/aiResponder.js');
const peersSrc = read('services/peers.js');
const ohSrc = read('services/objectionHandler.js');
const learnSrc = read('services/learningDb.js');
const serverSrc = read('server.js');

check('jobFlipAsk module', /ensureJobFlipHeardAsk/.test(jobSrc) && /слышал о таком/.test(jobSrc));
check('churnLearn module', /classifyChurnReason/.test(churnSrc) && /noteDialogGone/.test(churnSrc));
check('ai wires ensure', /ensureJobFlipHeardAsk/.test(aiSrc));
check('ai keeps heard ask', /HEARD_RE\.test/.test(aiSrc));
check('DAY_ASK no чем занимаешься', !/чем\\s\+\(ты\\s\+\)\?занимаешься/.test(aiSrc) || !/DAY_ASK_RE[\s\S]{0,200}занимаешься/.test(aiSrc));
check('oh job hint flip', /слышал о таком|jobFlipHint/.test(ohSrc));
check('oh cyrillic boundary', /работаешь\(\?!\[а-яё\]\)/.test(ohSrc));
check('peers churn hook', /churnLearn/.test(peersSrc) && /noteDialogGone/.test(peersSrc));
check('learning recordChurnNegative', /recordChurnNegative/.test(learnSrc));
check('server ensureTables', /churnLearn/.test(serverSrc));

const jobFlip = require('../services/jobFlipAsk');
const churn = require('../services/churnLearn');
check('runtime job', jobFlip.isJobOccupationAsk('кем работаешь?'));
check(
  'runtime ensure',
  jobFlip.HEARD_RE.test(jobFlip.ensureJobFlipHeardAsk('ок)', 'чем занимаешься?')),
);
check(
  'runtime churn',
  churn.classifyChurnReason([
    { role: 'assistant', content: 'флипаю токены)' },
  ]) === 'after_nft_pitch',
);

console.log(fail ? `HARD_AUDIT_FAIL ${fail}` : 'HARD_AUDIT_OK');
process.exit(fail ? 1 : 0);
