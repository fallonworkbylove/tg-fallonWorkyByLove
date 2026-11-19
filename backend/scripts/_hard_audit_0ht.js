#!/usr/bin/env node
/**
 * Hard audit 0ht — scaleOps wiring + humanization regress gates.
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

check('scaleOps exists', fs.existsSync(path.join(root, 'services/scaleOps.js')));
const so = require('../services/scaleOps');
check('exports busy', typeof so.persistBusy === 'function' && typeof so.pickBusyDelayMs === 'function');
check('exports waves', typeof so.activateInWaves === 'function');
check('exports throttle', typeof so.loadThrottleState === 'function');
check('exports burst', typeof so.burstExtraDelayMs === 'function');
check('exports pools', typeof so.getPoolRoleCounts === 'function');
check('exports checklist', typeof so.checklistForAccount === 'function');
check('exports templates', Array.isArray(so.PERSONA_TEMPLATES) && so.PERSONA_TEMPLATES.length >= 4);
check('exports tasks', typeof so.enqueueTask === 'function' && typeof so.listOpenTasks === 'function');
check('exports echo/offtopic', typeof so.breakShortAckEcho === 'function' && typeof so.fixOfftopicMoveReply === 'function');

// behavioral (ночь МСК 01–08 → ×1.45, днём ≤6м)
{
  const samples = [];
  for (let i = 0; i < 20; i++) {
    samples.push(so.pickBusyDelayMs({ userText: 'видео пришли?', explicitMedia: true }));
  }
  const max = Math.max(...samples);
  const min = Math.min(...samples);
  check('busy hot ≤6м (или ≤9м ночью)', min >= 120_000 && max <= 9 * 60_000, `range ${min}-${max}`);
}
const offtopic = so.fixOfftopicMoveReply('дома сижу сериал', 'когда переезжаешь?');
check('offtopic move', /пару\s+недел|скоро/i.test(offtopic));
const echo = so.breakShortAckEcho('угу', [{ role: 'assistant', content: 'ага)' }]);
check('ack echo break', echo !== 'угу');

const boot = read('services/sessionBootstrap.js');
check('boot waves', /activateInWaves/.test(boot));
check('boot restore busy', /restoreBusyFromDb/.test(boot));

const inbound = read('services/inbound.js');
check('inbound pickBusy', /pickBusyDelayMs/.test(inbound));
check('inbound persistBusy', /persistBusy/.test(inbound));
check('inbound clearBusy', /clearBusyForAccount/.test(inbound));

const pipe = read('services/replyPipeline.js');
check('pipe clearBusy', /clearBusy\(/.test(pipe));
check('pipe throttle', /loadThrottleState/.test(pipe));
check('pipe burst', /noteBurstReply/.test(pipe) && /burstExtraDelayMs/.test(pipe));

const soft = read('services/softHumanLite.js');
check('soft echo+move', /breakShortAckEcho/.test(soft) && /fixOfftopicMoveReply/.test(soft));

const ops = read('services/opsQuality.js');
check('ops pools', /getPoolRoleCounts/.test(ops));
check('ops silence skip deferred', /deferredDialogs/.test(ops));

const acc = read('routes/accounts.js');
check('api templates', /persona-templates/.test(acc));
check('api pool-roles', /pool-roles/.test(acc));
check('api worker-tasks', /worker-tasks/.test(acc));
check('api start-ai checklist', /checklistForAccount/.test(acc) && /canEnableAi/.test(acc));

// human regress (must not vanish)
const howCandidates = ['services/howLong.js', 'services/howLongStay.js', 'services/leadScoring.js'];
const howPath = howCandidates.find((p) => fs.existsSync(path.join(root, p)));
check('howlong module', !!howPath);
if (howPath) {
  const how = read(howPath);
  check('howlong отсев', /отсев|21|markPeerFiltered/i.test(how));
}
const hh = read('services/humanHardening.js');
check('flip это я guard', /это я|beard|flip|чуж/i.test(hh) || /это\s*я/.test(hh));
const phrase = read('services/softHumanLite.js');
check('kaif anti-echo', /breakKaifEcho/.test(phrase));

const fe = read('../frontend/updates.js');
check('miniapp changelog 0ht', /Шаблоны персонажей|занята не теряется|нагрузк/i.test(fe));
const opsUp = read('../ops-console/app/updates.js');
check('ops changelog 0ht', /Шаблоны персонажей|занята не теряется|нагрузк/i.test(opsUp));
const tg = read('../CHANGELOG_TG.md');
check('changelog tag 0ht', /^## 0ht\./m.test(tg));
const idx = read('../frontend/index.html');
check('updates bump ≥148', /updates\.js\?v=1[4-9]\d|updates\.js\?v=[2-9]\d{2,}/.test(idx));
check('persona select UI', /id="persona-template"/.test(idx));

if (fail) {
  console.error('HARD_AUDIT_FAIL', fail);
  process.exit(1);
}
console.log('HARD_AUDIT_0HT_OK');
process.exit(0);
