#!/usr/bin/env node
/**
 * 0gv: interestHits больше не стопорит NFT-кампанию (порог 0).
 * Остальные гейты (clone / flip-photo 24h / cool) живы.
 */
const assert = require('assert');
const hh = require('../services/humanHardening');

const aid = 92001;
const pid = `smoke-0gv-${Date.now()}`;

assert.strictEqual(
  hh.shouldBlockNftPitch(aid, pid, 'привет', []),
  false,
  '0 hits must NOT block NFT when NFT_MIN_INTEREST_HITS=0',
);

assert.strictEqual(
  hh.shouldBlockNftPitch(aid, pid, 'все вы одинаковые боты', []),
  true,
  'clone skeptic still blocks',
);

hh.noteFlipPhotoSent(aid, pid);
assert.strictEqual(
  hh.shouldBlockNftPitch(aid, pid, 'ок', []),
  true,
  'flip photo 24h cooldown still blocks',
);

console.log('SMOKE_INTEREST_HITS_0GV_OK');
process.exit(0);
