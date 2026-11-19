#!/usr/bin/env node
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_PROXY_LIST = '';
'use strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-smoke-local';

const fs = require('fs');
const path = require('path');
const mediaSend = require('../services/mediaSend');

let failed = 0;
function ok(name, cond, detail = '') {
  if (cond) {
    console.log(`OK  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const refuse = 'не, не сегодня, извин';
ok('isMediaRefusal_ne_segodnya', mediaSend.isMediaRefusalText(refuse));
ok('contradictory_ne_segodnya', mediaSend.isContradictoryMediaText(refuse));

const stripped = mediaSend.stripContradictoryMediaParts(refuse);
ok('strip_ne_segodnya_empty', !stripped || !mediaSend.isMediaRefusalText(stripped), `got="${stripped}"`);

const withToken = mediaSend.extractMediaRequest(`${refuse} <<PHOTO>>`);
ok('extract_keeps_mediaType', withToken.mediaType === 'photo', `type=${withToken.mediaType}`);
ok(
  'extract_ack_not_refuse',
  withToken.text && !mediaSend.isMediaRefusalText(withToken.text),
  `text="${withToken.text}"`,
);
ok(
  'extract_ack_from_pool',
  mediaSend.MEDIA_SEND_ACK_POOL.includes(withToken.text) ||
    /найду|секунду|ща|держи|лови/i.test(withToken.text),
  `text="${withToken.text}"`,
);

const resolved = mediaSend.resolveMediaPromise(refuse, 'photo', 'давай еще пару фоточек)', [], true);
ok(
  'resolve_media_ack',
  resolved.outText && !mediaSend.isMediaRefusalText(resolved.outText),
  `out="${resolved.outText}"`,
);

const hard = mediaSend.resolveMediaPromise(
  'не могу такое скинуть',
  null,
  'скинь фото',
  [{ role: 'user', content: 'скинь фото' }],
  true,
);
ok('hard_refuse_no_force', hard.forceMedia === false, `force=${hard.forceMedia}`);

const ideasSrc = fs.readFileSync(path.join(__dirname, '../services/humanIdeas17.js'), 'utf8');
ok('ideas17_ne_segodnya', /не\\s\+сегодня/.test(ideasSrc) || /не\s+сегодня/.test(ideasSrc));
ok('ideas17_ack_pool', /окей, щас найду\)/.test(ideasSrc));

const ack = mediaSend.pickMediaSendAck();
ok('pick_ack', typeof ack === 'string' && ack.length > 1, `ack="${ack}"`);

const pipeSrc = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
ok('pipeline_ensureMediaAckText', /ensureMediaAckText/.test(pipeSrc));

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('ALL OK');
process.exit(0);
