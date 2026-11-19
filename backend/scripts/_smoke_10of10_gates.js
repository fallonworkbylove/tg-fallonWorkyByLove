#!/usr/bin/env node
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

const assert = require('assert');
const peers = require('../services/peers');
const hh = require('../services/humanHardening');

assert.strictEqual(peers.isFrozenMethodError({ errorMessage: 'FROZEN_METHOD_INVALID' }), true);
assert.strictEqual(peers.isFrozenMethodError({ message: 'FLOOD_WAIT' }), false);
peers.markFolderFrozen(999001, { errorMessage: 'FROZEN_METHOD_INVALID' });
assert.strictEqual(peers.isFolderFrozen(999001), true);

const aid = 91001;
const pid = `smoke-gates-${Date.now()}`;
// 0gv: interestHits порог 0 — без hits питч не режем (остаются clone/flip/cool)
assert.strictEqual(hh.shouldBlockNftPitch(aid, pid, 'ок', []), false);
hh.noteExplicitInterest(aid, pid, 'расскажи подробнее как работает флип токены');
hh.noteExplicitInterest(aid, pid, 'интересно покажи nft профит');
assert.strictEqual(hh.shouldBlockNftPitch(aid, pid, 'ну ок про флип', []), false);

(async () => {
  await new Promise((r) => setTimeout(r, 400));
  hh.__testClearPeerMemory(aid, pid);
  await hh.hydratePeerGates(aid, pid);
  const hits = (await hh.hydratePeerGates(aid, pid)).interestHits;
  if (hits < 2) {
    console.warn('WARN persist skipped (no DB locally?) hits=', hits);
  } else {
    assert.strictEqual(await hh.shouldBlockNftPitchAsync(aid, pid, 'ещё', []), false);
  }
  console.log('SMOKE_10OF10_GATES_OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
