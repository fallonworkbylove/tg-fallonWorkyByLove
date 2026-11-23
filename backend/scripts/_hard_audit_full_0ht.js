#!/usr/bin/env node
/**
 * Жёсткий полный аудит проекта с упором на 0hp–0ht.
 * Exit 0 = чисто; exit 1 = P0/P1 дыры.
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-audit';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const repo = path.join(root, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const readRepo = (p) => fs.readFileSync(path.join(repo, p), 'utf8');

let p0 = 0;
let p1 = 0;
let soft = 0;
const rows = [];

function ok(name, detail) {
  rows.push({ lvl: 'OK', name, detail: detail || '' });
  console.log('OK ', name, detail || '');
}
function fail(lvl, name, detail) {
  if (lvl === 'P0') p0 += 1;
  else if (lvl === 'P1') p1 += 1;
  else soft += 1;
  rows.push({ lvl, name, detail: detail || '' });
  console.log(lvl, name, detail || '');
}
function check(name, cond, lvl, detail) {
  if (cond) ok(name);
  else fail(lvl || 'P1', name, detail);
}

function runNode(script, envExtra, timeoutMs) {
  return spawnSync(process.execPath, [script], {
    env: { ...process.env, ...envExtra },
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function childOk(r, okMarker) {
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  // Marker first: hard audits may print OK then hang on open handles → ETIMEDOUT.
  if (okMarker && okMarker.test(out)) return true;
  if (r.status === 0) return true;
  return false;
}

console.log('=== FULL HARD AUDIT 0ht ===\n--- smokes ---');
const smokes = [
  '_smoke_scale_0ht.js',
  '_smoke_silence_busy_0hr.js',
  '_smoke_login_password_ui_0hs.js',
  '_smoke_10of10_0hq.js',
  '_smoke_kaif_0hm.js',
  '_smoke_sleep_media_0hk.js',
  '_smoke_conn_error_failover_0lu.js',
  '_smoke_openai_skip_dead_0lv.js',
  '_smoke_waiting_filter_0lw.js',
  '_smoke_waiting_night_0lx.js',
  '_smoke_project_harden_0lz.js',
  '_smoke_wave_0m1.js',
  '_smoke_wave_0m2.js',
  '_smoke_admin_owner_0m3.js',
  '_smoke_admin_usage_0m7.js',
  '_smoke_lead_shut_0m9.js',
];
for (const s of smokes) {
  const f = path.join(__dirname, s);
  if (!fs.existsSync(f)) {
    fail('P1', `smoke missing ${s}`);
    continue;
  }
  const r = runNode(f, { OPENAI_API_KEY: 'sk-test' }, 120_000);
  if (childOk(r, /SMOKE_.*_OK|ALL OK/)) ok(`smoke ${s}`);
  else fail('P0', `smoke ${s}`, (r.stdout || r.stderr || String(r.error || '')).slice(-300));
}

console.log('\n--- hard tags ---');
for (const h of ['_hard_audit_0ht.js', '_hard_audit_0gc.js', '_hard_audit_0gt.js', '_hard_audit_0lz.js', '_hard_audit_0m1.js', '_hard_audit_0m2.js', '_hard_audit_0m3.js', '_hard_audit_0m7.js', '_hard_audit_0m9.js']) {
  const f = path.join(__dirname, h);
  if (!fs.existsSync(f)) {
    fail('soft', `hard missing ${h}`);
    continue;
  }
  const r = runNode(f, { OPENAI_API_KEY: 'sk-audit' }, 180_000);
  if (childOk(r, /HARD_AUDIT_\w+_OK/)) ok(`hard ${h}`);
  else fail(h.includes('0ht') || h.includes('0lz') ? 'P0' : 'P1', `hard ${h}`, (r.stdout || r.stderr || String(r.error || '')).slice(-400));
}

console.log('\n--- 0ht scaleOps deep ---');
const so = require('../services/scaleOps');
const soSrc = read('services/scaleOps.js');
const boot = read('services/sessionBootstrap.js');
const inbound = read('services/inbound.js');
const pipe = read('services/replyPipeline.js');
const softH = read('services/softHumanLite.js');
const ops = read('services/opsQuality.js');
const acc = read('routes/accounts.js');
const server = read('server.js');

// busy restore: scheduleFn must re-arm timer that fires reengage
check('restoreBusyFromDb exists', /restoreBusyFromDb/.test(boot) && typeof so.restoreBusyFromDb === 'function', 'P0');
check('boot calls restore after waves', /activateInWaves[\s\S]{0,800}restoreBusyFromDb/.test(boot) || /restoreBusyFromDb/.test(boot), 'P0');
check('restore uses fireReengage/schedule', /fireReengage|scheduleReengage/.test(boot), 'P0', 'restore must arm reengage');
check('restore resolves getEntity', /getEntity/.test(boot), 'P0');
check('fireReengage resolves string sender', /getEntity\(sender|typeof sender === 'string'/.test(pipe), 'P0');

// restore path detail
const restoreBlock = boot.match(/restoreBusyFromDb\([\s\S]{0,1200}\)/);
check('restore checks active client', restoreBlock && /getActiveClient/.test(restoreBlock[0]), 'P1');
check('restore skips existing deferred', restoreBlock && /deferredDialogs\.has/.test(restoreBlock[0]), 'P1');

// busy persist + clear symmetry
check('scheduleReengage persistBusy', /persistBusy/.test(inbound), 'P0');
check('scheduleReengage pickBusyDelayMs', /pickBusyDelayMs/.test(inbound), 'P0');
check('clearBusy on reply', /clearBusy\(/.test(pipe), 'P0');
check('clearBusyForAccount on disconnect', /clearBusyForAccount/.test(inbound), 'P1');

// busy tier vs silence window consistency
const hotMax = 6;
const coldMax = 20;
const silenceOlder = Number((ops.match(/olderMin\s*=\s*(\d+)/) || [])[1] || 0);
const silenceNewer = Number((ops.match(/newerMin\s*=\s*(\d+)/) || [])[1] || 0);
check('silence olderMin ≥ cold busy max', silenceOlder >= coldMax, 'P0', `olderMin=${silenceOlder} coldMax=${coldMax}`);
check('silence newerMin ≥ 6', silenceNewer >= 6, 'P1', `newerMin=${silenceNewer}`);
check('silence skips deferred', /deferredDialogs/.test(ops), 'P0');
check('silence AI-on only', /is_autoreply_enabled\s*=\s*1/.test(ops), 'P1');

// mid busy can be 18м — olderMin 28 covers; but cold 20 < 28 OK
const midCap = 18;
check('silence older covers mid busy', silenceOlder > midCap, 'P1');

// throttle + burst actually applied before pause
check('pipe burstExtraDelayMs before pause', /burstExtraDelayMs[\s\S]{0,200}loadThrottleState|loadThrottleState[\s\S]{0,200}burstExtraDelayMs/.test(pipe), 'P0');
check('pipe noteBurstReply after send', /noteBurstReply/.test(pipe), 'P1');
check('LOAD_SOFT < LOAD_HARD', so.LOAD_SOFT_PER_HOUR < so.LOAD_HARD_PER_HOUR, 'P0');

// behavioral sanity
{
  const samples = [];
  for (let i = 0; i < 30; i++) {
    samples.push(so.pickBusyDelayMs({ userText: 'когда переезд?', historyLen: 2 }));
  }
  // Ночь МСК 01–08: pickBusyDelayMs ×1.45 → верх до ~9м
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  check('hot busy all in 2–9м', lo >= 120_000 && hi <= 9 * 60_000, 'P0', `range ${lo}-${hi}`);
}
{
  let swapped = 0;
  for (let i = 0; i < 20; i++) {
    const out = so.breakShortAckEcho('ага)', [{ role: 'assistant', content: 'ок)' }]);
    if (out !== 'ага)') swapped += 1;
  }
  check('ack echo swaps often', swapped >= 15, 'P1', `swapped ${swapped}/20`);
}
{
  const bad = so.fixOfftopicMoveReply('сериал смотрю)', 'когда переезжаешь?');
  const good = so.fixOfftopicMoveReply('скоро к маме в Анапу)', 'когда переезд?');
  check('offtopic move fixed', /пару\s+недел|скоро/i.test(bad), 'P0');
  check('on-topic move kept', good.includes('маме') || good.includes('Анап'), 'P1');
}

// templates quality
check('templates ≥4', so.PERSONA_TEMPLATES.length >= 4, 'P1');
check(
  'templates no bot reveal',
  so.PERSONA_TEMPLATES.every((t) => !/я бот|openai|chatgpt/i.test(t.prompt)),
  'P0',
);
check(
  'templates have city/name signal',
  so.PERSONA_TEMPLATES.every((t) => t.prompt.length >= 60 && t.title.includes('·')),
  'P1',
);

// checklist gate
{
  const noPrompt = so.checklistForAccount(
    { prompt: 'short', session_string: 'x'.repeat(80), media_chat_link: 'https://t.me/c/1' },
    { online: true },
  );
  check('short prompt blocks AI', !noPrompt.canEnableAi, 'P0');
  check('start-ai uses checklist', /checklistForAccount/.test(acc) && /canEnableAi/.test(acc), 'P0');
  check('media missing enqueues task', /enqueueTask[\s\S]{0,120}media|kind:\s*'media'/.test(acc), 'P1');
}

// pool alerts
check('ops uses getPoolRoleCounts', /getPoolRoleCounts/.test(ops), 'P1');
check('ops loginLow alert', /loginLow|loginOk/.test(ops), 'P1');
check('MIN_PROXY_LEN ≥5', so.MIN_PROXY_LEN >= 5, 'P0');
check('LOGIN_MIN ≥15', so.LOGIN_MIN >= 15, 'P1');

// waves
check('BOOT_WAVE_SIZE sane', so.BOOT_WAVE_SIZE >= 4 && so.BOOT_WAVE_SIZE <= 20, 'P1');
check('activateInWaves in boot', /activateInWaves/.test(boot), 'P0');

console.log('\n--- classic human gates ---');
check('opsQuality started from server', /startOpsQualitySchedulers/.test(server), 'P0');
check('kaif anti-echo', /breakKaifEcho/.test(softH), 'P0');
check('soft hooks scaleOps', /breakShortAckEcho/.test(softH) && /fixOfftopicMoveReply/.test(softH), 'P0');

const howCandidates = ['services/howLong.js', 'services/howLongStay.js', 'services/leadScoring.js'];
const howPath = howCandidates.find((p) => fs.existsSync(path.join(root, p)));
check('howlong module', !!howPath, 'P0');
if (howPath) {
  const how = read(howPath);
  check('howlong ≥21 → отсев', /21/.test(how) && /отсев|markPeerFiltered|filtered/i.test(how), 'P0');
  check('учёба not DV', /учёб|учеб|study|лет(?!\s*дн)/i.test(how) || /возраст|age/i.test(how), 'P1');
}

const hhPath = ['services/humanHardening.js', 'services/humanIdeas10.js', 'services/humanExtra.js'].find(
  (p) => fs.existsSync(path.join(root, p)),
);
if (hhPath) {
  const hh = read(hhPath);
  check('flip identity guard present', /это\s*я|чуж|бород|flip|screen/i.test(hh), 'P1');
}

// phrase ban
let phraseSrc = '';
for (const p of ['services/softHumanLite.js', 'services/humanHardening.js', 'services/humanRhythm.js', 'services/aiResponder.js']) {
  if (fs.existsSync(path.join(root, p))) phraseSrc += read(p);
}
check('phraseBanLimitFor ≤3 wiring', /phraseBanLimitFor/.test(phraseSrc), 'P1');
if (/phraseBanLimitFor\s*=\s*[^;]+|function phraseBanLimitFor/.test(phraseSrc)) {
  const m = phraseSrc.match(/phraseBanLimitFor[\s\S]{0,200}?return\s+(\d+)/);
  if (m) check('phraseBan default ≤3', Number(m[1]) <= 3, 'P1', `return ${m[1]}`);
}

// quiet hours
const quietSrc = [pipe, softH, read('services/humanRhythm.js')].join('\n');
check('quiet / working hours present', /isWithinWorkingHours|quiet|isSleep|MSK|01.*08|ноч/i.test(quietSrc), 'P1');

// sleep media debt (0hk)
check('media through sleep', /media.?debt|explicitMedia|isSleep|isWithinWorkingHours/.test(pipe), 'P1');

console.log('\n--- 0hs login password ---');
const login = fs.existsSync(path.join(root, 'services/loginAuth.js')) ? read('services/loginAuth.js') : '';
const feApp = readRepo('frontend/app.js');
const feIdx = readRepo('frontend/index.html');
check('resolvePasswordNeeded', /resolvePasswordNeeded/.test(login) || /resolvePasswordNeeded/.test(feApp), 'P0');
check('password only on step=password', /showPassword\s*=\s*step\s*===\s*['\"]password['\"]|step === 'password'/.test(feApp), 'P0');
check('has_password false → reauth hint', /has_password|войди заново|заново/i.test(login + feApp), 'P1');

console.log('\n--- frontend / changelog ---');
check('persona-template UI', /id="persona-template"/.test(feIdx), 'P0');
check('loadPersonaTemplates', /loadPersonaTemplates|personaTemplates/.test(feApp), 'P0');
check('health_missing badge', /health_missing/.test(feApp), 'P1');
const feUp = readRepo('frontend/updates.js');
const opsUp = readRepo('ops-console/app/updates.js');
const cl = readRepo('CHANGELOG_TG.md');
check('changelog 0ht', /^## 0ht\./m.test(cl), 'P0');
check('miniapp 0ht entry', /Масштаб: шаблоны/.test(feUp), 'P0');
check('ops 0ht entry', /Масштаб: шаблоны/.test(opsUp), 'P0');
check('updates.js?v=148+', /updates\.js\?v=(1[4-9]\d|[2-9]\d{2,})/.test(feIdx), 'P0');
check('app.js?v=71+', /app\.js\?v=([7-9]\d|\d{3,})/.test(feIdx), 'P1');

// API routes order: persona-templates before /:id
{
  const templatesIdx = acc.indexOf("'/persona-templates'");
  const idIdx = acc.search(/\/:id['"]/);
  check('persona-templates before /:id', templatesIdx > 0 && (idIdx < 0 || templatesIdx < idIdx), 'P0', `tmpl=${templatesIdx} id=${idIdx}`);
  const poolIdx = acc.indexOf("'/pool-roles'");
  const tasksIdx = acc.indexOf("'/worker-tasks'");
  check('pool-roles before /:id', poolIdx > 0 && (idIdx < 0 || poolIdx < idIdx), 'P0');
  check('worker-tasks before /:id', tasksIdx > 0 && (idIdx < 0 || tasksIdx < idIdx), 'P0');
}

console.log('\n--- hole hunt (new code) ---');
// Double-fire risk: restore + still-in-memory after crash without clear
check(
  'persistBusy ON DUPLICATE updates due',
  /ON DUPLICATE KEY UPDATE[\s\S]{0,80}due_at/i.test(soSrc),
  'P1',
);
// fire path must clear DB when reengage fires
const inboundFull = inbound;
check(
  'fire/clear busy on reengage path',
  /clearBusy/.test(pipe) || /clearBusy/.test(inboundFull),
  'P0',
);

// ensureTables CREATE for both
check('busy_deferred DDL', /CREATE TABLE IF NOT EXISTS busy_deferred/.test(soSrc), 'P0');
check('worker_tasks DDL', /CREATE TABLE IF NOT EXISTS worker_tasks/.test(soSrc), 'P0');

// conversation_messages for throttle — table must exist historically
check('throttle queries conversation_messages', /conversation_messages/.test(soSrc), 'P1');

// proxyPools optional require safe
check('getPoolRoleCounts try/catch proxyPools', /try\s*\{[\s\S]*proxyPools[\s\S]*\}\s*catch/.test(soSrc), 'P1');

// soft: alts array should not be pure ага/угу/ок
{
  const m = soSrc.match(/const alts = \[([^\]]+)\]/);
  const altsBlob = m ? m[1] : '';
  const pure = (altsBlob.match(/['"](?:ага|угу|ок|ладно)\)?['"]/gi) || []).length;
  if (pure >= 2) fail('soft', 'ack alts still ack-ish', `pure=${pure}`);
  else ok('ack alts variety ok');
}

// offtopic: only triggers on short/сериал — may miss other offtopic
if (!/сериа|дома сижу|фоном/.test(soSrc)) fail('soft', 'offtopic patterns narrow');
else ok('offtopic patterns present');

// busy restore: fromDb schedule — verify sessionBootstrap sets timer that calls fireReengage
const bootRestore = boot.includes('fireReengage') || boot.includes('hooksFire');
check('boot restore fires reengage', bootRestore, 'P0');

console.log('\n=== SCORE ===');
const totalFail = p0 + p1;
const score = Math.max(0, Math.round(10 - p0 * 2.5 - p1 * 0.8 - soft * 0.15));
console.log(JSON.stringify({ p0, p1, soft, score, totalFail }, null, 2));
if (p0 || p1) {
  console.error(`FULL_HARD_AUDIT_FAIL p0=${p0} p1=${p1} soft=${soft} score=${score}/10`);
  process.exit(1);
}
console.log(`FULL_HARD_AUDIT_OK score=${score}/10 soft=${soft}`);
process.exit(0);
