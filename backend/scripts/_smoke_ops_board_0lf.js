/**
 * Smoke 0lf: proxy summary, heard A/B soft, memory sport, lang strip, scale busy.
 * Dummy key — adminOps тянет цепочку до aiResponder.
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-smoke-0lf-local';
const fs = require('fs');
const path = require('path');

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
  console.log('OK', msg);
};

const adminOpsSrc = fs.readFileSync(path.join(__dirname, '../services/adminOps.js'), 'utf8');
assert(/work_alive/.test(adminOpsSrc), 'adminOps work_alive');
assert(/openai_ready/.test(adminOpsSrc), 'adminOps openai_ready');
assert(/require\.cache/.test(adminOpsSrc), 'adminOps cache peek');
assert(/personaPreview/.test(adminOpsSrc), 'personaPreview');
assert(/flagBadReply/.test(adminOpsSrc), 'flagBadReply');

const jobFlip = require('../services/jobFlipAsk');
assert(Array.isArray(jobFlip.HEARD_TAILS_SOFT) && jobFlip.HEARD_TAILS_SOFT.length >= 2, 'soft tails');
const softPick = jobFlip.pickHeardTail({ softShare: 1, random: () => 0 });
assert(softPick.variant === 'soft', 'pickHeardTail soft');
const hardPick = jobFlip.pickHeardTail({ softShare: 0, random: () => 0.9 });
assert(hardPick.variant === 'hard', 'pickHeardTail hard');

const withSoft = jobFlip.ensureJobFlipHeardAsk(
  'флипаю токены онлайн)',
  'кем работаешь?',
  { ageHours: 48, history: [], softShare: 1, random: () => 0 },
);
assert(jobFlip.HEARD_RE.test(withSoft) || /знакомо|в теме|сталкивался|слышать/i.test(withSoft), 'ensure soft/hard hear');

const memSrc = fs.readFileSync(path.join(__dirname, '../services/memoryTriggers.js'), 'utf8');
assert(/type:\s*'sport'/.test(memSrc), 'memory sport pattern');
assert(/type:\s*'show'/.test(memSrc), 'memory show pattern');
assert(/type:\s*'car'/.test(memSrc), 'memory car pattern');

const aiSrc = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
assert(/photo\|image\|picture\|screenshot/.test(aiSrc), 'lang strip vision english');

const scale = require('../services/scaleOps');
const dayMs = scale.pickBusyDelayMs({ userText: 'привет', historyLen: 2 });
assert(Number.isFinite(dayMs) && dayMs >= 60_000, 'busy delay ms');

const opsQSrc = fs.readFileSync(path.join(__dirname, '../services/opsQuality.js'), 'utf8');
assert(/runOpenAiReadyWatch/.test(opsQSrc), 'openai watch');
assert(/runAccountOfflineWatch/.test(opsQSrc), 'offline watch');

const statsSrc = fs.readFileSync(path.join(__dirname, '../services/adminConsoleStats.js'), 'utf8');
assert(/funnelBoard/.test(statsSrc), 'funnelBoard');
assert(/getCostSummary/.test(statsSrc), 'cost in snapshot');

const routeSrc = fs.readFileSync(path.join(__dirname, '../routes/adminConsole.js'), 'utf8');
assert(/persona-preview/.test(routeSrc), 'persona-preview route');
assert(/learn\/bad-reply/.test(routeSrc), 'bad-reply route');

const adminOps = require('../services/adminOps');
const proxies = adminOps.listProxies();
assert(proxies && Array.isArray(proxies.work), 'listProxies.work');
assert(proxies.summary && typeof proxies.summary.work === 'number', 'summary.work');
assert('openai_ready' in proxies.summary, 'summary.openai_ready');

console.log('SMOKE_0lf_OK');
process.exit(0);
