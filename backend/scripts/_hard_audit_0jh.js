#!/usr/bin/env node
'use strict';
/**
 * Hard audit B · 0jh — wiring 0jf/0jg/0jh + human regress gates.
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-audit';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

const hh = read('services/humanHardening.js');
const ms = read('services/mediaSend.js');
const i17 = read('services/humanIdeas17.js');
const i18 = read('services/humanIdeas18.js');

check('ideas17_module', /applyIdeas17Postfilters/.test(i17) && /buildIdeas17Hints/.test(i17));
check('ideas18_module', /applyIdeas18Postfilters/.test(i18) && /buildIdeas18Hints/.test(i18));
check('wire_hints_17', /buildIdeas17Hints/.test(hh));
check('wire_hints_18', /buildIdeas18Hints/.test(hh));
check('wire_post_17', /applyIdeas17Postfilters/.test(hh));
check('wire_post_18', /applyIdeas18Postfilters/.test(hh));

check('media_leftover_re', /MEDIA_PROMISE_LEFTOVER_RE/.test(ms));
check('media_strip_fn', /function stripMediaPromise/.test(ms));
check('media_resolve_fn', /function resolveMediaPromise/.test(ms));
check('media_leftover_podozhd', /подожд|норм\w*\s*фото|<<>>/i.test(ms));

const soft = read('services/softHumanLite.js');
check('kaif anti-echo', /breakKaifEcho|phraseBanLimitFor/.test(soft) || /kaif/i.test(soft));

const howCandidates = ['services/howLong.js', 'services/howLongStay.js', 'services/leadScoring.js'];
const howPath = howCandidates.find((p) => fs.existsSync(path.join(root, p)));
check('howlong module', !!howPath);
if (howPath) {
  const how = read(howPath);
  check('howlong отсев', /отсев|markPeerFiltered/i.test(how));
}

check('flip guard', /это\s*я|flip|чуж|beard/i.test(hh));

const fe = read('../frontend/updates.js');
const opsUp = read('../ops-console/app/updates.js');
const tg = read('../CHANGELOG_TG.md');
const idx = read('../frontend/index.html');
check('changelog 0jh miniapp', /медиа|фото|обеща|обруб/i.test(fe));
check('changelog 0jh ops', /медиа|фото|обеща|обруб/i.test(opsUp));
check('changelog tag 0jh', /^## 0jh\./m.test(tg));
check('updates v≥188', /updates\.js\?v=18[8-9]|updates\.js\?v=19\d|updates\.js\?v=[2-9]\d{2,}/.test(idx));

// runtime media strip
const media = require('../services/mediaSend');
const leftover = media.stripMediaPromise(
  'ща скину нормальное фото подожд <<лайф>> держи)',
);
check(
  'runtime_strip_leftover',
  !/подожд|нормальное фото|<<|>>/i.test(leftover),
  leftover,
);

const i18m = require('../services/humanIdeas18');
check('runtime_ideas18', typeof i18m.applyIdeas18Postfilters === 'function');
const i17m = require('../services/humanIdeas17');
check('runtime_ideas17', typeof i17m.applyIdeas17Postfilters === 'function');

if (fail) {
  console.error('HARD_AUDIT_0JH_FAIL', fail);
  process.exit(1);
}
console.log('HARD_AUDIT_0JH_OK');
