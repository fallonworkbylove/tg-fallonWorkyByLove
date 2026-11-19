#!/usr/bin/env node
/**
 * Hard audit 0hv — new help pack + regress gates.
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

console.log('--- smoke 0hv ---');
const smoke = spawnSync(process.execPath, [path.join(__dirname, '_smoke_help_0hv.js')], {
  env: { ...process.env, OPENAI_API_KEY: 'sk-test' },
  encoding: 'utf8',
  timeout: 60_000,
});
check('smoke_help_0hv', smoke.status === 0, (smoke.stdout || smoke.stderr || '').slice(-400));

console.log('--- wiring 0hv ---');
const pipe = read('services/replyPipeline.js');
check('mediaDebt fireReengage', /mediaDebt/.test(pipe) && /histForMedia/.test(pipe));
check('busy skip on media debt', /unfulfilledMediaPromiseCount\(history\) === 0/.test(pipe));

const soft = require('../services/softHumanLite');
const cut = soft.softCompleteCut('послушай «Moon» от, тоже классный трек');
check('track stub soft', /вспомн|вылетело|забыла|группа/i.test(cut));

const ai = require('../services/aiResponder');
check('isBroken track', ai.isBrokenChatLine('послушай «Moon» от,'));
const city = ai.fixSwappedCurrentCity(
  'я сейчас в Анапе)',
  'норм?',
  [{ role: 'assistant', content: 'пока в Липецке)' }],
  'Ты из Липецка, переезжаешь в Анапу к маме',
);
check('city false-there', /липецк|пока|еду/i.test(city) && !/^я сейчас в Анапе/i.test(String(city)));

const soSrc = read('services/scaleOps.js');
check('unique login Set', /new Set\(lines/.test(soSrc));

const fe = read('../frontend/index.html');
const app = read('../frontend/app.js');
check('tasks UI', /worker-tasks-list/.test(fe) && /loadWorkerTasks/.test(app) && /done-task/.test(app));
check('changelog bump', /updates\.js\?v=150/.test(fe) && /app\.js\?v=72/.test(fe));

const feUp = read('../frontend/updates.js');
const opsUp = read('../ops-console/app/updates.js');
const cl = read('../CHANGELOG_TG.md');
check('changelog 0hv', /^## 0hv\./m.test(cl));
check('miniapp 0hv', /Медиа после паузы/.test(feUp));
check('ops 0hv', /Медиа после паузы/.test(opsUp));

console.log('--- regress ---');
check('kaif', /breakKaifEcho/.test(read('services/softHumanLite.js')));
check('busy restore entity', /getEntity/.test(read('services/sessionBootstrap.js')));
check('silence skip deferred', /deferredDialogs/.test(read('services/opsQuality.js')));
check('opsQuality start', /startOpsQualitySchedulers/.test(read('server.js')));
const how = ['services/howLong.js', 'services/howLongStay.js', 'services/leadScoring.js'].find((p) =>
  fs.existsSync(path.join(root, p)),
);
check('howlong', !!how && /21|отсев|markPeerFiltered/i.test(read(how)));

if (fail) {
  console.error('HARD_AUDIT_0HV_FAIL', fail);
  process.exit(1);
}
console.log('HARD_AUDIT_0HV_OK');
