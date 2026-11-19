#!/usr/bin/env node
/**
 * #12 nightly hard-audit: static 0gc + log greps for known human bugs.
 * Exit 0 = clean enough; exit 1 = findings (optionally alert).
 */
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const findings = [];

function note(msg) {
  findings.push(msg);
  console.error('FIND', msg);
}

const hard = spawnSync(process.execPath, [path.join(__dirname, '_hard_audit_0gc.js')], {
  env: process.env,
  encoding: 'utf8',
});
if (hard.status !== 0) {
  note('hard_audit_0gc failed');
  console.log(hard.stdout || '');
  console.error(hard.stderr || '');
}

const logCandidates = [
  '/root/.pm2/logs/tgbot-out.log',
  path.join(process.env.HOME || '', '.pm2/logs/tgbot-out.log'),
].filter((p) => p && fs.existsSync(p));

if (logCandidates.length) {
  const log = logCandidates[0];
  let tail = '';
  try {
    tail = execSync(`tail -n 8000 ${JSON.stringify(log)}`, { encoding: 'utf8', maxBuffer: 5e6 });
  } catch (_) {
    tail = fs.readFileSync(log, 'utf8').slice(-400000);
  }
  const badFlip = (tail.match(/это\s+я[\s),!.].{0,40}бород|борода\s+тебе/gi) || []).length;
  if (badFlip >= 3) note(`flip-identity-ish hits in log: ${badFlip}`);
  const qMark = (tail.match(/→ \? дн\./g) || []).length;
  const parsed = (tail.match(/→ \d+ дн\./g) || []).length;
  if (qMark > parsed && qMark > 15) note(`howlong ? дн. high: ${qMark} vs parsed ${parsed}`);
  const peerInv = (tail.match(/PEER_ID_INVALID/g) || []).length;
  if (peerInv >= 10) note(`PEER_ID_INVALID x${peerInv}`);
} else {
  console.log('(no pm2 out log locally — skip live greps)');
}

if (findings.length) {
  const body =
    `<b>Nightly audit</b>\n` + findings.map((f) => `· ${f}`).join('\n');
  try {
    const { sendAdminAlert } = require('../services/helpRequestNotifier');
    if (process.env.ADMIN_ALERT_CHAT_ID) {
      sendAdminAlert(body).catch(() => {});
    }
  } catch (_) {
    /* offline */
  }
  console.error(`NIGHTLY_HARD_AUDIT_FAIL ${findings.length}`);
  process.exit(1);
}
console.log('NIGHTLY_HARD_AUDIT_OK');
