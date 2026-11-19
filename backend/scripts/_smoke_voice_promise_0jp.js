#!/usr/bin/env node
'use strict';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const vr = require('../services/voiceReplies');
const post = require('../services/aiResponderPostprocess');
const path = require('path');
const fs = require('fs');
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail);
  }
}

ok(
  'strip_tag',
  vr.stripLeakedVoiceTag('лови) [голосовое: za_.ogg]') === 'лови)' ||
    vr.stripLeakedVoiceTag('[голосовое: za_.ogg]') === '',
  vr.stripLeakedVoiceTag('лови) [голосовое: za_.ogg]'),
);

ok(
  'bare_tag_empty',
  vr.stripLeakedVoiceTag('[голосовое: za_.ogg]') === '',
);

const refused = vr.softVoiceAskWithoutFile(
  'окей, сейчас запишу что-то интересное',
  'Расскажи голосовым\nЗа жизнь',
  { voiceWillSend: false },
);
ok('promise_refused', /стесня|текстом|голосом не|не то скажу/i.test(refused), refused);
ok('promise_no_zapishu', !/запишу/i.test(refused), refused);

const keep = vr.softVoiceAskWithoutFile('лови)', 'Расскажи голосовым', {
  voiceWillSend: true,
});
ok('keep_when_sending', keep === 'лови)', keep);

const final = post.finalizeOutgoingReply('[голосовое: za_.ogg]', 'Расскажи голосовым', {
  voiceWillSend: false,
});
ok('final_no_tag', !/\[голосовое/i.test(final || ''), final);
ok('final_has_text', !!(final && final.length > 2), final);

const hit = vr.findVoiceForText('Расскажи голосовым\nЗа жизнь');
ok('trigger_osebe', hit && hit.fileName === 'o sebe.ogg', hit && hit.fileName);

const triggers = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../voices/triggers.json'), 'utf8'),
);
const osebe = triggers.find((r) => r.file === 'o sebe.ogg');
ok('kw_za_zhizn', osebe && osebe.keywords.includes('за жизнь'));

const media = fs.readFileSync(
  path.join(__dirname, '../services/mediaSend.js'),
  'utf8',
);
ok('media_strip_voice', /голосовое\s*:/.test(media));

if (fail) {
  console.error('SMOKE_0JP_FAIL', fail);
  process.exit(1);
}
console.log('ALL_OK_0jp');
process.exit(0);
