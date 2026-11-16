#!/usr/bin/env node
/**
 * Wave 0lj: A1 bot-accusation · D1 softHumanGates · B3 NFT board fields · C1 no fallback-1
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-smoke-0lj';
const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
  console.log('OK', msg);
}

const gatesPath = path.join(__dirname, '../services/softHumanGates.js');
assert(fs.existsSync(gatesPath), 'softHumanGates.js exists');
const gates = require('../services/softHumanGates');
const soft = require('../services/softHumanLite');

/* ——— A1 ——— */
const ACCUSE = 'Чел, у тебя бот поплыл';
assert(gates.isBotAccusation(ACCUSE), 'detect поплыл');
assert(gates.isBotAccusation('ты бот что ли'), 'detect ты бот');
assert(!gates.isBotAccusation('привет как дела'), 'not accuse on hello');

const bad = 'хах, ну ок) просто я не бот, а Лер)';
const fixed = gates.fixBotAccusationReply(bad, ACCUSE, []);
assert(fixed && !/не\s+бот/i.test(fixed), `no «не бот» → ${fixed}`);
assert(!/\bлер\b/i.test(fixed), `no name stamp → ${fixed}`);
assert(fixed.length <= 40, `short alt → ${fixed}`);

const viaLite = soft.applySoftLite(bad, [], ACCUSE);
assert(!/не\s+бот/i.test(viaLite), `applySoftLite A1 → ${viaLite}`);

/* ——— D1 re-exports ——— */
assert(typeof soft.fixBotAccusationReply === 'function', 'soft re-exports fixBotAccusation');
assert(typeof soft.isBareGreeting === 'function', 'soft still has isBareGreeting');
assert(soft.isBareGreeting('При-вет\u{1F596}'), 'hyphen greeting via gates');

const g = soft.fixAckOnBareGreeting('мм, поняла)', 'При-вет\u{1F596}');
assert(/привет|хай/i.test(g) && !/поняла/i.test(g), `greet ack → ${g}`);

/* ——— C1 ——— */
const checkSrc = fs.readFileSync(path.join(__dirname, '_check_getuserid_fallback.js'), 'utf8');
assert(/dbUser\s*\?\s*.*:\s*1|:\s*1\s*;|fallback/i.test(checkSrc) || /FAIL/.test(checkSrc), 'C1 checker present');
const { spawnSync } = require('child_process');
const c1 = spawnSync(process.execPath, [path.join(__dirname, '_check_getuserid_fallback.js')], {
  encoding: 'utf8',
});
assert(c1.status === 0, `C1 gate exit0: ${c1.stdout}${c1.stderr}`);

/* ——— B3 ——— */
const liveSrc = fs.readFileSync(path.join(__dirname, '../services/opsLiveMetrics.js'), 'utf8');
assert(/staleDialog|stale_dialog/.test(liveSrc), 'opsLiveMetrics staleDialog');
assert(/openWork|workPending/.test(liveSrc), 'opsLiveMetrics open/pending');
assert(/liveDialog90|live90/.test(liveSrc), 'opsLiveMetrics live90');

const statsSrc = fs.readFileSync(path.join(__dirname, '../services/adminConsoleStats.js'), 'utf8');
assert(/staleDialog/.test(statsSrc), 'funnelBoard.staleDialog');
assert(/openWork/.test(statsSrc), 'funnelBoard.openWork');
assert(/liveDialog90/.test(statsSrc), 'funnelBoard.liveDialog90');

const routeSrc = fs.readFileSync(path.join(__dirname, '../routes/adminConsole.js'), 'utf8');
assert(/nft\/expire-stale|expire-stale/.test(routeSrc), 'expire-stale route');

const appSrc = fs.readFileSync(path.join(__dirname, '../../frontend/app.js'), 'utf8');
assert(/staleDialog|Stuck без ГС|expire-stale|nft-expire/.test(appSrc), 'frontend NFT board');

/* ——— B1 ——— */
const auditSrc = fs.readFileSync(path.join(__dirname, '_audit_c_full_now.sh'), 'utf8');
assert(
  /HARD_AUDIT_FAST|timeout 120s.*_hard_audit_0ht|timeout 300s.*_hard_audit_0ht/.test(
    auditSrc.replace(/\n/g, ' '),
  ),
  'audit hard_0ht fast/timeout',
);
assert(
  /timeout 180s.*_nightly|nightly.*180/.test(auditSrc.replace(/\n/g, ' ')) ||
    /timeout 180s node scripts\/_nightly/.test(auditSrc),
  'audit nightly 180s',
);
assert(fs.existsSync(path.join(__dirname, '_cron_audit_c.sh')), 'cron audit script');

console.log('SMOKE_0lj_OK');
process.exit(0);
