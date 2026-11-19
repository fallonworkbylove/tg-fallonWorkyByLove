#!/usr/bin/env node
'use strict';

/**
 * Smoke 0jh: stripMediaPromise не оставляет «подожд / нормальное фото / <<>>».
 */
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

const fs = require('fs');
const path = require('path');
const ms = require('../services/mediaSend');

let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail);
  }
}

function clean(s) {
  return ms.stripMediaPromise(s);
}

ok('empty_token', clean('щас поищу нормальное <<>>') === '' || !/<<|нормальн|поищу/i.test(clean('щас поищу нормальное <<>>')), clean('щас поищу нормальное <<>>'));
ok('podozhd_stump', !/подожд/i.test(clean('щас поищу, подожд)')), clean('щас поищу, подожд)'));
ok('norm_photo', !/нормальн|подожд|поищу/i.test(clean('щас поищу нормальное фото, подожди немного')), clean('щас поищу нормальное фото, подожди немного'));
ok('koroche', !/подожд|поищу|короче\s*$/i.test(clean('короче щас поищу, подожди')), clean('короче щас поищу, подожди'));
ok('keep_life', /жизнь/i.test(clean('да, жизнь такая) а фото щас поищу, подожд)')), clean('да, жизнь такая) а фото щас поищу, подожд)'));
ok('keep_life_no_stump', !/подожд|поищу/i.test(clean('да, жизнь такая) а фото щас поищу, подожд)')), clean('да, жизнь такая) а фото щас поищу, подожд)'));

const withFile = ms.resolveMediaPromise(
  'короче щас поищу, подожди',
  'photo',
  'скинь фото',
  [],
  true,
);
ok(
  'send_ack',
  withFile.outText && !/подожд|поищу|короче/i.test(withFile.outText),
  withFile.outText,
);

const refuseSend = ms.resolveMediaPromise(
  'не кину такое, стыдно',
  'photo',
  'скинь фото',
  [],
  true,
);
ok('refuse_to_ack', !/не\s+кину|стыдно/i.test(refuseSend.outText), refuseSend.outText);

const noMedia = ms.resolveMediaPromise(
  'щас поищу нормальное фото, подожди немного',
  null,
  'скинь фото',
  [],
  false,
);
ok(
  'no_link_deflect',
  noMedia.forceMedia === false && !/подожд\s*$|нормальное фото, подожди/i.test(noMedia.outText),
  noMedia.outText,
);

const src = fs.readFileSync(path.join(__dirname, '../services/mediaSend.js'), 'utf8');
ok('has_leftover_re', /MEDIA_PROMISE_LEFTOVER_RE/.test(src));

if (fail) {
  console.error('SMOKE_FAIL_0jh', fail);
  process.exit(1);
}
console.log('ALL_OK_0jh');
process.exit(0);
