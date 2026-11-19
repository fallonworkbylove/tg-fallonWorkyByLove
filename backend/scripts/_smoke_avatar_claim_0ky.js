#!/usr/bin/env node
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_PROXY_LIST = '';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-smoke-local';
'use strict';

let failed = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log(`OK  ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const oh = require('../services/objectionHandler');
const avatarMatch = require('../services/avatarMatch');

const claim = 'Вот эта реальная твоя фотка';
const cool = 'прикольное фото) у тебя тоже есть такие?';

ok(
  'deny_when_not_own',
  /не я/i.test(oh.softenClaimedHerPhotoReply(cool, claim, { matchesOwnAvatar: false })),
);

const ownConfirm = oh.softenClaimedHerPhotoReply(cool, claim, { matchesOwnAvatar: true });
ok(
  'confirm_when_own_avatar',
  /(?:это\s+)?я|моя\s+фот|ага.*я/i.test(ownConfirm) && !/не я/i.test(ownConfirm),
  `got=${ownConfirm}`,
);

const tagged =
  '[фото от собеседника]: девушка. [совпало с моей аватаркой] Подпись: "Вот эта реальная твоя фотка".';
const fromTag = oh.softenClaimedHerPhotoReply(cool, tagged);
ok(
  'confirm_from_inbound_tag',
  /(?:это\s+)?я|моя\s+фот|ага.*я/i.test(fromTag) && !/не я/i.test(fromTag),
  `got=${fromTag}`,
);

const denyKeep = oh.softenClaimedHerPhotoReply(
  'короче не, это не я)',
  claim,
  { matchesOwnAvatar: true },
);
ok(
  'flip_deny_to_confirm_on_own',
  /(?:это\s+)?я|моя\s+фот/i.test(denyKeep) && !/не я/i.test(denyKeep),
  `got=${denyKeep}`,
);

ok('exports_match_fn', typeof avatarMatch.matchesOwnAccountAvatar === 'function');
ok('exports_tag', typeof avatarMatch.OWN_AVATAR_TAG === 'string' && /аватар/i.test(avatarMatch.OWN_AVATAR_TAG));
ok(
  'detect_tag_helper',
  avatarMatch.messageHasOwnAvatarTag(tagged) === true &&
    avatarMatch.messageHasOwnAvatarTag(claim) === false,
);

const pipe = require('fs').readFileSync(
  require('path').join(__dirname, '../services/replyPipeline.js'),
  'utf8',
);
ok(
  'pipeline_passes_own_flag',
  /matchesOwnAvatar|messageHasOwnAvatarTag|OWN_AVATAR_TAG/.test(pipe),
);

const inbound = require('fs').readFileSync(
  require('path').join(__dirname, '../services/inbound.js'),
  'utf8',
);
ok('inbound_wires_avatar_match', /matchesOwnAccountAvatar|OWN_AVATAR_TAG/.test(inbound));

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('ALL OK');
process.exit(0);
