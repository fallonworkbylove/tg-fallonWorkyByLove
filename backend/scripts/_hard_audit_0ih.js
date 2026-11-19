#!/usr/bin/env node
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-audit';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let fail = 0;
function check(n, ok, d) {
  if (ok) console.log('OK', n);
  else {
    fail += 1;
    console.log('FAIL', n, d || '');
  }
}

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const smoke = spawnSync(process.execPath, [path.join(__dirname, '_smoke_regress.js')], {
  encoding: 'utf8',
});
check('smoke_regress', smoke.status === 0, smoke.stderr || smoke.stdout);

const hh = read('services/humanHardening.js');
check('ideas14 wired', /humanIdeas14/.test(hh));
const pipe = read('services/replyPipeline.js');
check('skip reason logs', /skip reason=/.test(pipe));
check('media after noshow', /media_after_noshow/.test(pipe));
const help = read('services/helpRequestNotifier.js');
check('notifier restart', /restartNotificationBot/.test(help) && /jitter|0\.7 \+ Math\.random/.test(help));
const proxy = read('services/proxyPools.js');
check('notConnected burst', /noteNotConnectedBurst/.test(proxy));
const admin = read('routes/adminConsole.js');
check('health+notifier routes', /\/health/.test(admin) && /notifier\/restart/.test(admin));
const obj = read('services/objectionHandler.js');
check('silent skip warm', /msgs_7d|interest.*pitch.*operator/.test(obj));

const fe = read('../frontend/updates.js');
check('miniapp 0ih', /Живее ответы|опечат|не покаж|метрик/i.test(fe.slice(0, 3000)));
const tg = read('../CHANGELOG_TG.md');
check('changelog 0ih', /^## 0ih\./m.test(tg));
const idx = read('../frontend/index.html');
check('updates v≥162', /updates\.js\?v=16[2-9]|updates\.js\?v=1[7-9]\d/.test(idx));
check('day hint', /ДЕНЬ 1\/2\/3|Дни 1–2–3/.test(idx));

if (fail) {
  console.error('HARD_AUDIT_FAIL', fail);
  process.exit(1);
}
console.log('HARD_AUDIT_0IH_OK');
