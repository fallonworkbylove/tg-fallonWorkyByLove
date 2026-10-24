#!/usr/bin/env node
/**
 * Smoke: редкий мягкий смайл в хвосте сохраняется; россыпь режется.
 */
const ai = require('../services/aiResponder');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else console.log('ok', msg);
}

const fn = ai.applyAntiDetectStyle;
assert(typeof fn === 'function', 'applyAntiDetectStyle exported');

const soft = fn('ну ты милый) 😊');
assert(/😊/.test(soft) && /милый/i.test(soft), 'keeps soft tail: ' + soft);

const multi = fn('привет 🔥 😂 🥰 классно');
assert(!/🔥|😂/.test(multi), 'strips mid spam: ' + multi);

const love = fn('рада что написал) 🥰');
assert(/🥰/.test(love), 'keeps 🥰: ' + love);

const bang = fn('Приветик! Рада)');
assert(!/!/.test(bang) && /Приветик/i.test(bang), 'no bang: ' + bang);

console.log('SOFT_SMILE', process.exitCode ? 'FAIL' : 'OK');
process.exit(process.exitCode || 0);
