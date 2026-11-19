#!/usr/bin/env node
'use strict';
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-smoke';
const oh = require('../services/objectionHandler');
const wrap =
  '[фото от собеседника]: девушка. [совпало с моей аватаркой] Подпись: "это ты?".';
const cool = 'прикольное фото) у тебя тоже есть такие?';
const r1 = oh.softenClaimedHerPhotoReply(cool, wrap, { matchesOwnAvatar: true });
const r2 = oh.softenClaimedHerPhotoReply('да, это я)', 'это ты?', { matchesOwnAvatar: true });
const flip = oh.softenFlipPhotoIdentityReply(
  'ага, это я)',
  'это ты?',
  [{ role: 'assistant', content: '[медиа] флип' }],
  { flipRecent: true },
);
console.log('wrap+own=', r1);
console.log('bare+own=', r2);
console.log('flip-rewrite=', flip);
console.log(
  'P0_wrap_fail=',
  /нфт|не я|прикольно/i.test(r1) || !/(?:это\s+)?я|моя\s+фот/i.test(r1),
);
