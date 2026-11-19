#!/usr/bin/env node
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-smoke-local';
process.env.OPENAI_PROXY_LIST = '';
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
const am = require('../services/avatarMatch');
const hl = require('../services/howLong');
const fs = require('fs');
const path = require('path');

const wrapTy =
  '[фото от собеседника]: девушка. [совпало с моей аватаркой] Подпись: "это ты?".';
const cool = 'прикольное фото) у тебя тоже есть такие?';

const fromWrap = oh.softenClaimedHerPhotoReply(cool, wrapTy, { matchesOwnAvatar: true });
ok(
  'p0_wrap_confirm',
  /(?:это\s+)?я|моя\s+фот|аватар/i.test(fromWrap) && !/не я|прикольно/i.test(fromWrap),
  `got=${fromWrap}`,
);

const fromTagOnly = oh.softenClaimedHerPhotoReply(cool, '[совпало с моей аватаркой]');
ok(
  'p0_tag_alone_confirm',
  /(?:это\s+)?я|моя\s+фот/i.test(fromTagOnly) && !/не я/i.test(fromTagOnly),
  `got=${fromTagOnly}`,
);

const flipBlocked = oh.softenFlipPhotoIdentityReply(
  'ага, это я)',
  wrapTy,
  [{ role: 'assistant', content: '[фото от меня: флиппинг nft]' }],
  { flipRecent: true, matchesOwnAvatar: true },
);
ok(
  'p0_flip_skips_own_avatar',
  /это я/i.test(flipBlocked) && !/нфт/i.test(flipBlocked),
  `got=${flipBlocked}`,
);

ok(
  'p1_caption_eto_ty',
  am.captionClaimsHerPhoto('это ты?') === true,
);
ok(
  'p1_caption_tvoja',
  am.captionClaimsHerPhoto('Вот эта реальная твоя фотка') === true,
);

const histHow = [
  { role: 'assistant', content: 'а ты сколько дней на дв?' },
  { role: 'user', content: 'хз' },
];
ok('p1_howlong_open_after_hz', hl.isAnswerToHowLong(histHow) === true);
ok('p1_howlong_parse_month', hl.parseStayDays('месяц') === 30);

const histDone = [
  { role: 'assistant', content: 'а ты сколько дней на дв?' },
  { role: 'user', content: 'месяц' },
  { role: 'assistant', content: 'поняла)' },
];
ok('p1_howlong_closed_after_stay', hl.isAnswerToHowLong(histDone) === false);

ok(
  'p1_howlong_hint_gate',
  oh.lastAssistantWasHowLongQuestion([
    { role: 'assistant', content: 'а ты сколько дней на дв?' },
    { role: 'user', content: 'хз' },
  ]) === false,
);
ok(
  'p1_howlong_hint_waiting',
  oh.lastAssistantWasHowLongQuestion([
    { role: 'assistant', content: 'а ты сколько дней на дв?' },
  ]) === true,
);

ok(
  'p2_short_eto_not_photo_point',
  oh.isAskingAboutSentPhoto('это?') === false,
);
ok(
  'p2_a_eto_still_photo_point',
  oh.isAskingAboutSentPhoto('а это?') === true || oh.isAskingAboutSentPhoto('а это') === true,
);

const pipe = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
ok('wire_flip_own_skip', /matchesOwnAvatar|messageHasOwnAvatarTag/.test(pipe));
ok('wire_reengage_howlong', /isAnswerToHowLong[\s\S]{0,200}parseStayDays/.test(
  pipe.slice(pipe.indexOf('async function fireReengage')),
));

const nft = fs.readFileSync(path.join(__dirname, '../services/nftCampaign.js'), 'utf8');
ok('wire_voice_skip_stuck', /voice_skip|voiceSkip|markNftVoiceSkipped|voice_forbidden/.test(nft));

const obj = fs.readFileSync(path.join(__dirname, '../services/objectionHandler.js'), 'utf8');
ok('wire_silence_voice_forbidden', /isVoiceForbiddenError/.test(obj));

const metrics = fs.readFileSync(path.join(__dirname, '../services/opsLiveMetrics.js'), 'utf8');
ok('metrics_exclude_skip', /voice_skip/.test(metrics));

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('ALL OK');
process.exit(0);
