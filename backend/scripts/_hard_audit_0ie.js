#!/usr/bin/env node
/**
 * Hard audit 0ie — growth pack wiring + human regress.
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-audit';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

const smoke = spawnSync(process.execPath, [path.join(__dirname, '_smoke_growth_0ie.js')], {
  encoding: 'utf8',
});
check('smoke_growth_0ie', smoke.status === 0, smoke.stderr || smoke.stdout);

const pipe = read('services/replyPipeline.js');
check('pipe no trash wire', !/trashPeerFilter/.test(pipe));
check('pipe metrics nearDup', /opsLiveMetrics/.test(pipe) && /nearDupSkip/.test(pipe));
check('pipe later text', /detectLaterTextPromise/.test(pipe) && /scheduleLaterTextReturn/.test(pipe));

const how = read('services/howLong.js');
check('howlong 21d', /HOWLONG_ARCHIVE_DAYS\s*=\s*21/.test(how));

const lead = read('services/leadScoring.js');
check(
  'filter gate howlong|silent',
  /давно\\s\+на\\s\+дв/.test(lead) && /молчит/.test(lead) && !/\/мусор\/i\.test\(finalNote\)/.test(lead),
);

const soft = read('services/softHumanLite.js');
check('kaif anti-echo', /breakKaifEcho/.test(soft));
check('merge bubbles in applySoftLite', /mergeTwoQuestionBubbles\(out/.test(soft));

const silence = read('services/silenceCatchup.js');
check('silenceHeal bump', /opsLiveMetrics.*silenceHeal|bump\('silenceHeal'\)/.test(silence));

const fe = read('../frontend/updates.js');
check('miniapp 0ie title', /Память|напишу позже|мусор|Метрики|QR/i.test(fe.slice(0, 2500)));
const opsUp = read('../ops-console/app/updates.js');
check('ops 0ie title', /Память|напишу позже|мусор|Метрики|QR/i.test(opsUp.slice(0, 2500)));
const tg = read('../CHANGELOG_TG.md');
check('changelog 0ie', /^## 0ie\./m.test(tg));
const idx = read('../frontend/index.html');
check('updates v≥159', /updates\.js\?v=15[9]|updates\.js\?v=1[6-9]\d|updates\.js\?v=[2-9]\d{2,}/.test(idx));

const auth = read('middleware/telegramAuth.js');
check(
  'auth bypass gated by env',
  /TELEGRAM_AUTH_BYPASS/.test(auth) && !/process\.env\.TELEGRAM_AUTH_BYPASS_FORCE\s*=\s*['"]true['"]/.test(auth),
);

if (fail) {
  console.error('HARD_AUDIT_FAIL', fail);
  process.exit(1);
}
console.log('HARD_AUDIT_0IE_OK');
