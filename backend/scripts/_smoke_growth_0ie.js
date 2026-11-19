#!/usr/bin/env node
/**
 * Smoke 0ie: memory 7d, text_promises, merge bubbles, trash, Bot SOCKS, metrics.
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const fs = require('fs');
const path = require('path');

function assert(c, m) {
  if (!c) {
    console.error('FAIL', m);
    process.exit(1);
  }
  console.log('OK', m);
}

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const mem = read('services/memoryTriggers.js');
assert(/INTERVAL 7 DAY/.test(mem), 'memory 7d window');
assert(/pruneOldMemory/.test(mem), 'pruneOldMemory export');

const hh = read('services/humanHardening.js');
assert(/CREATE TABLE IF NOT EXISTS text_promises/.test(hh), 'text_promises schema');
assert(/restoreTextPromisesFromDb/.test(hh), 'restore text_promises');
assert(/detectLaterTextPromise/.test(hh), 'detect later text');

const inbound = read('services/inbound.js');
assert(/fireOneLaterTextReturn/.test(inbound) && /flushDueTextPromises/.test(inbound), 'inbound text return');

const soft = require('../services/softHumanLite');
const merged = soft.mergeTwoQuestionBubbles('норм\nна работе', 'как дела? чем занят?');
assert(
  typeof soft.mergeTwoQuestionBubbles === 'function' &&
    (!merged.includes('\n') || merged === 'норм\nна работе'),
  'mergeTwoQuestionBubbles callable',
);
const twoQ = soft.mergeTwoQuestionBubbles('ок\nдома', 'как сам? где ты?');
assert(!/\n/.test(String(twoQ).replace(/^\s*<<[^>]+>>\s*/, '')), 'two short answers → one bubble');

const pipe = read('services/replyPipeline.js');
assert(!/isTrashPeerMessage/.test(pipe), 'pipe без trash wire (0if)');
assert(/cancelDeferredText/.test(pipe), 'cancel text promise on inbound');

const lead = read('services/leadScoring.js');
assert(/молчит/.test(lead) && /давно\\s\+на\\s\+дв/.test(lead), 'markPeerFiltered howlong|silent');

const help = read('services/helpRequestNotifier.js');
assert(/socksDispatcher/.test(help) && /firstSocks5FromEnv/.test(help), 'Bot API SOCKS');

const metrics = require('../services/opsLiveMetrics');
metrics.bump('replies');
assert(typeof metrics.getLiveMetrics === 'function', 'getLiveMetrics');
assert(metrics.counters.replies >= 1, 'bump replies');

const admin = read('routes/adminConsole.js');
assert(/router\.get\(\s*'\/metrics'/.test(admin) && /requireAdmin/.test(admin), 'admin /metrics');

const boot = read('services/sessionBootstrap.js');
assert(/restoreTextPromisesFromDb/.test(boot) && /pruneOldMemory/.test(boot), 'boot restore+prune');

const opsQ = read('services/opsQuality.js');
assert(/flushDueTextPromises/.test(opsQ), 'opsQuality text-promise tick');

const ai = require('../services/aiResponder');
assert(typeof ai.firstSocks5FromEnv === 'function', 'firstSocks5FromEnv exported');

const opsHtml = read('../ops-console/app/index.html');
assert(/data-panel="metrics"/.test(opsHtml) && /metrics-console/.test(opsHtml), 'Electron metrics panel');

console.log('SMOKE_GROWTH_0IE_OK');
