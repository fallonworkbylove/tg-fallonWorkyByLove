/**
 * Smoke 0ht: scaleOps — busy tiers, echo, offtopic, throttle wiring, templates.
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const fs = require('fs');
const path = require('path');

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('OK', msg);
  }
};

const so = require('../services/scaleOps');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// #24 busy tiers (ночь МСК 01–08 → ×1.45: hot≤9м, mid≤26м, cold≤29м)
const hot = so.pickBusyDelayMs({ userText: 'когда переезд?', historyLen: 3 });
assert(hot >= 2 * 60_000 && hot <= 9 * 60_000, `hot busy 2–9м got ${Math.round(hot / 1000)}s`);
const cold = so.pickBusyDelayMs({ userText: 'привет', historyLen: 25 });
assert(cold >= 8 * 60_000 && cold <= 29 * 60_000, `cold busy 8–29м got ${Math.round(cold / 1000)}s`);
const mid = so.pickBusyDelayMs({ userText: 'норм', historyLen: 5 });
assert(mid >= 5 * 60_000 && mid <= 26 * 60_000, `mid busy 5–26м got ${Math.round(mid / 1000)}s`);

// #18 short ack echo
const echoed = so.breakShortAckEcho('ага)', [
  { role: 'assistant', content: 'ок)' },
  { role: 'user', content: 'да' },
]);
assert(echoed !== 'ага)', `breakShortAckEcho swaps: ${echoed}`);
assert(
  so.breakShortAckEcho('ага)', [{ role: 'user', content: 'да' }]) === 'ага)',
  'no echo without prior ack',
);

// #22 offtopic move
const fixed = so.fixOfftopicMoveReply('сериал смотрю дома)', 'когда переезжаешь?');
assert(/пару\s+недел|скоро/i.test(fixed), `offtopic move fixed: ${fixed}`);
assert(
  so.fixOfftopicMoveReply('скоро к маме)', 'когда переезд?') === 'скоро к маме)',
  'on-topic move kept',
);
assert(
  /пару\s+недел/i.test(so.softenMoveTiming('на днях к маме уеду)', 'когда переезд?')),
  'soften на днях → пару недель',
);

// #11 templates
assert(so.PERSONA_TEMPLATES.length >= 4, 'persona templates ≥4');
assert(so.PERSONA_TEMPLATES.every((t) => t.id && t.title && t.prompt.length > 20), 'templates shaped');

// #9 checklist
const bad = so.checklistForAccount({ prompt: '', session_string: '', media_chat_link: '' }, { online: false });
assert(!bad.canEnableAi && bad.missing.includes('промпт'), 'checklist blocks empty');
const good = so.checklistForAccount(
  {
    prompt: 'x'.repeat(50),
    session_string: 'y'.repeat(60),
    media_chat_link: 'https://t.me/c/1',
    is_autoreply_enabled: 1,
  },
  { online: true },
);
assert(good.ok && good.state === 'ai_on', 'checklist ai_on');

// #23 burst
so.noteBurstReply(1, 2);
so.noteBurstReply(1, 2);
so.noteBurstReply(1, 2);
const burst = so.burstExtraDelayMs(1, 2);
// 0is/0iz: burst смягчён (3–8с), не 8–25с — иначе чат «замирает»
assert(burst >= 3000 && burst <= 9000, `burst delay after 3 hits: ${burst}`);

// #5 pools shape
const pools = so.getPoolRoleCounts();
assert(typeof pools.work === 'number' && typeof pools.login === 'number', 'pool roles shape');
assert('workOk' in pools && 'loginOk' in pools, 'pool ok flags');

// wiring static
const boot = read('services/sessionBootstrap.js');
assert(/activateInWaves/.test(boot) && /restoreBusyFromDb/.test(boot), 'bootstrap waves+restore');
assert(/getEntity/.test(boot), 'bootstrap restore resolves entity');
const inbound = read('services/inbound.js');
assert(/pickBusyDelayMs/.test(inbound) && /persistBusy/.test(inbound), 'inbound busy persist');
const pipe = read('services/replyPipeline.js');
assert(/burstExtraDelayMs/.test(pipe) && /loadThrottleState/.test(pipe), 'pipeline throttle+burst');
assert(/busy reengage: не резолвил|getEntity\(sender/.test(pipe), 'fireReengage resolves string sender');
const ai = read('services/aiResponder.js');
assert(/планирр/.test(ai) && /поеом/.test(ai), 'typo fixes планирр/поеом');
const soft = read('services/softHumanLite.js');
assert(/breakShortAckEcho/.test(soft) && /fixOfftopicMoveReply/.test(soft), 'softHumanLite hooks');
const ops = read('services/opsQuality.js');
assert(/getPoolRoleCounts/.test(ops), 'opsQuality pool alerts');
const acc = read('routes/accounts.js');
assert(/persona-templates/.test(acc) && /worker-tasks/.test(acc) && /checklistForAccount/.test(acc), 'accounts API');

console.log(process.exitCode ? 'SMOKE_FAIL' : 'SMOKE_SCALE_0HT_OK');
process.exit(process.exitCode || 0);
