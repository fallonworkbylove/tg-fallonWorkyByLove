'use strict';
/**
 * Smoke 0t5: media reciprocity — «сначала ты» / отказ при давлении.
 */
process.env.AUDIT_SMOKE = '1';

const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const modPath = path.join(__dirname, '../services/mediaReciprocity.js');
const src = fs.readFileSync(modPath, 'utf8');
assert(/peer_media_barter/.test(src), 'table');
assert(/сначала ты/.test(src), 'you first phrase');
assert(/не собачка/.test(src), 'refuse phrase');

const mr = require(modPath);
assert(mr.isMediaAsk('скинь кружок'), 'ask circle');
assert(mr.isMediaAsk('пришли фото'), 'ask photo');
assert(!mr.isMediaAsk('как дела)'), 'not ask');
assert(mr.isAggressive('скинь уже сука'), 'aggressive');
assert(mr.isPeerMediaText('[фото от собеседника]: селфи'), 'peer media');
assert(mr.YOU_FIRST_ALTS.some((a) => /сначала ты/i.test(a)), 'alts you first');
assert(mr.REFUSE_ALTS.some((a) => /собачка/i.test(a)), 'alts refuse');

const held = mr.enforceReply('щас кину фото)', {
  blockSend: true,
  forceReply: null,
});
assert(/сначала ты|сперва ты|ты перв/i.test(held), 'enforce rewrite');

const forced = mr.enforceReply('что угодно', {
  blockSend: true,
  forceReply: 'ну тогда и я не скину, я же не собачка чтобы приказы выполнять)',
});
assert(/собачка/.test(forced), 'force refuse');

const pipe = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
assert(/mediaReciprocity/.test(pipe), 'pipeline require');
assert(/media_reciprocity/.test(pipe), 'skip reason');
assert(/markFulfilled/.test(pipe), 'mark fulfilled');

console.log('SMOKE_0t5_OK');
process.exit(0);
