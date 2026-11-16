#!/usr/bin/env node
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-smoke-0lm';
const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
  console.log('OK', msg);
}

const gates = require('../services/softHumanGates');
const soft = require('../services/softHumanLite');

/* A2 */
const histMiss = [{ role: 'assistant', content: 'эм, сейчас дома, жду посылку))' }];
const q = gates.fixDayTalkOnBareQuestion('эм, сейчас дома, жду посылку))', '?', histMiss);
assert(!/посылк|дома/i.test(q), `A2 bare? after miss → ${q}`);
const q2 = soft.applySoftLite('сижу дома сериал смотрю', [{ role: 'assistant', content: 'привет)' }], '?');
assert(!/сериал|дома сиж/i.test(q2) || /про что|запутала|мысли|да так/i.test(q2), `A2 via lite → ${q2}`);

/* E1 empty quotes */
const badQ = 'хм, а, ну да, забыла написать названия) «» и « War»';
const fixedQ = gates.fixEmptyQuotedTitles(badQ);
assert(!/«\s*»/.test(fixedQ) && !/«\s*War»/i.test(fixedQ), `E1 quotes → ${fixedQ}`);
assert(/назван|игр|стратег|квест|хах|забыла/i.test(fixedQ) || fixedQ.length < badQ.length, 'E1 still readable');

/* E2 vague filler */
const vague = gates.fixVagueFillerReply('похоже, вопрос открыт)', 'ну', []);
assert(!/вопрос открыт/i.test(vague), `E2 vague → ${vague}`);

const viaLite = soft.applySoftLite(badQ, [], 'какие игры?');
assert(!/«\s*»/.test(viaLite), `lite E1 → ${viaLite}`);

/* C3 */
const rl = fs.readFileSync(path.join(__dirname, '../middleware/httpRateLimit.js'), 'utf8');
assert(/12,\s*60_000/.test(rl) && /accounts\/connect/.test(rl), 'C3 tighter IP login limit');
const lr = require('../services/loginRate');
assert(typeof lr.allowLoginAttempt === 'function', 'loginRate export');
const ok1 = lr.allowLoginAttempt({ userId: 'smoke-user', phone: '79990001122' });
assert(ok1.ok === true, 'loginRate first ok');
const accSrc = fs.readFileSync(path.join(__dirname, '../routes/accounts.js'), 'utf8');
assert(/allowLoginAttempt/.test(accSrc), 'accounts wires loginRate');

/* B4 */
const guard = fs.readFileSync(path.join(__dirname, '_deploy_guard.sh'), 'utf8');
assert(/updates\.js\?v=|CHANGELOG_TG|0g[a-z0-9]+/.test(guard), 'B4 changelog sync in guard');

/* D2 */
const audit = fs.readFileSync(path.join(__dirname, '_audit_c_full_now.sh'), 'utf8');
assert(/HARD_AUDIT_FAST/.test(audit), 'D2 HARD_AUDIT_FAST');

console.log('SMOKE_0lm_OK');
process.exit(0);
