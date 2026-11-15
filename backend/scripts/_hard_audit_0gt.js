#!/usr/bin/env node
/**
 * Hard audit 0gt — wiring + regression gates for ideas12 + watchdogs.
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-audit';
const fs = require('fs');
const path = require('path');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

check('ideas12 exists', fs.existsSync(path.join(root, 'services/humanIdeas12.js')));
const i12 = require('../services/humanIdeas12');
check('pool size', i12.STATUS_POOL.length >= 20);
check('status gate', i12.isStatusAsk('че делаешь'));
check('mishear gate', !/расслышал/i.test(i12.stripFalseMishear('не расслышала)', 'норм текст длинный')));
check('multi fact', i12.stripMultiSelfFacts('я из Казани. работаю врачом. у меня кот.').split('.').length <= 3);

const hh = read('services/humanHardening.js');
const pipe = read('services/replyPipeline.js');
// ideas12 wired from replyPipeline (deferred_interest), not humanHardening
check('hh i12', /humanIdeas12/.test(hh) || /humanIdeas12/.test(pipe));

const ops = read('services/opsQuality.js');
check('ops proxy', /runProxyAliveWatch/.test(ops));
check('ops session', /runSessionCountWatch/.test(ops));
check('ops start wires', /proxyWatchTimer/.test(ops) && /sessionWatchTimer/.test(ops));

check('pipe emotion', /EMOTION_REACT_ALLOW/.test(pipe));
check('pipe defer', /deferred_interest/.test(pipe));
check('pipe suppress', /shouldSuppressReaction/.test(pipe));

const ai = read('services/aiResponder.js');
check('ai openai list', /OPENAI_PROXY_LIST/.test(ai));
check('ai mishear hint soft', /ТОЛЬКО если расшифровка реально каша/.test(ai));

const cl = read('services/clientPool.js');
check('client count', /function getActiveClientCount/.test(cl));

// howlong / phrase still present (no regress)
const howCandidates = ['services/howLong.js', 'services/howLongStay.js', 'services/leadScoring.js'];
const howPath = howCandidates.find((p) => fs.existsSync(path.join(root, p)));
check('howlong-ish module', !!howPath);
if (howPath) {
  const how = read(howPath);
  check('howlong content', /21|отсев|howLong|parseStay/i.test(how));
}

const fe = read('../frontend/updates.js');
check('miniapp changelog', /Живее ответы и сторож прокси/.test(fe));

const tg = read('../CHANGELOG_TG.md');
check('changelog 0gt', /^## 0gt\./m.test(tg) || tg.includes('## 0gt.'));

if (fail) {
  console.error('HARD_AUDIT_FAIL', fail);
  process.exit(1);
}
console.log('HARD_AUDIT_0GT_OK');
