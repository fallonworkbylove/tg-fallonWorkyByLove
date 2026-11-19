#!/usr/bin/env node
'use strict';

if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-test';

const fs = require('fs');
const path = require('path');
const ms = require('../services/mediaSend');
const { isSpecificMediaSceneRequest } = require('../services/mediaReplies');

let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail);
  }
}

ok(
  'ask_skiny_veshi',
  ms.isPackedThingsPhotoAsk('Скинь сколько вещей собрала'),
);
ok(
  'ask_sfotkay',
  ms.isPackedThingsPhotoAsk('Так сейчас просто сфоткай сколько вещей да и все'),
);
ok(
  'ask_pokazhesh_ctx',
  ms.isPackedThingsPhotoAsk('покажешь?', [
    { role: 'assistant', content: 'собираю вещи потихоньку)' },
    { role: 'user', content: 'Хахаха, покажешь?' },
  ]),
);
ok('not_generic_photo', !ms.isPackedThingsPhotoAsk('скинь фото)'));
ok('not_selfie', !ms.isPackedThingsPhotoAsk('себя покажи'));

// Регресс 0ls: его фото машины ≠ просьба коробок (Екатерина → Александр).
const carCaption =
  '[стикер от собеседника]: На фото изображен мужчина, который стоит рядом с автомобилем. Он одет в темный капюшон и куртку.';
ok('peer_media_detect', ms.isPeerIncomingMediaCaption(carCaption));
ok(
  'not_car_photo_as_boxes',
  !ms.isPackedThingsPhotoAsk(carCaption, [
    { role: 'assistant', content: 'собираю коробки потихоньку)' },
    { role: 'user', content: 'покажешь?' },
  ]),
);
const rPeer = ms.resolveMediaPromise(
  'ого, крутая тачка) где это?',
  null,
  carCaption,
  [{ role: 'assistant', content: 'собираю коробки)' }],
  true,
);
ok('peer_photo_no_packed', rPeer.packedThings !== true, JSON.stringify(rPeer));
ok('peer_photo_keeps_reply', /тачка|ого/i.test(rPeer.outText), rPeer.outText);

const r = ms.resolveMediaPromise(
  'ну типа можно, подожди, щас найду нормальное фото',
  null,
  'Скинь сколько вещей собрала',
  [],
  true,
);
ok('resolve_no_force', r.forceMedia === false, JSON.stringify(r));
ok('resolve_excuse', /бардак|стыдно|срач|короб|куче|словами/i.test(r.outText), r.outText);
ok('resolve_flag', r.packedThings === true);

ok('scene_veshi', isSpecificMediaSceneRequest('скинь фото вещей'));
ok('excuse_bank', /бардак|стыдно|срач|короб|куче/i.test(ms.pickPackedThingsExcuse()));

const pipe = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
ok('wire_pipe', /packedThings|packed_things_unavailable/.test(pipe));
const hh = fs.readFileSync(path.join(__dirname, '../services/humanHardening.js'), 'utf8');
ok('wire_hint', /Вещей\/коробок|вещей\/коробок/.test(hh));

if (fail) {
  console.error('SMOKE_FAIL_0iq', fail);
  process.exit(1);
}
console.log('ALL_OK');
process.exit(0);
