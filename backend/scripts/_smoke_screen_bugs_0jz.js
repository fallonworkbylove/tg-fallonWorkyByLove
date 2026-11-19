#!/usr/bin/env node
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_PROXY_LIST = '';
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log(`OK  ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-smoke-local';

const oh = require('../services/objectionHandler');
const i17 = require('../services/humanIdeas17');
const thin = require('../services/humanThinLayer');

ok(
  'flip_bare_ne_ya',
  /нфт/i.test(
    oh.softenFlipPhotoIdentityReply('короче не, это не я)', 'это ты?', [
      { role: 'assistant', content: '[медиа:#1] флип нфт скрин' },
    ], { flipRecent: true }),
  ),
);

ok(
  'claimed_photo_not_cool',
  /не я/i.test(
    oh.softenClaimedHerPhotoReply(
      'прикольное фото) у тебя тоже есть такие?',
      'Вот эта реальная твоя фотка',
    ),
  ),
);

ok(
  'bot_leak',
  !/бот/i.test(i17.denyBotOrScriptAdmit('хах, обычный бот в телеге) просто пишу', 'Бот?')) ||
    /живая|чего|коротко/i.test(
      i17.denyBotOrScriptAdmit('хах, обычный бот в телеге) просто пишу', 'Бот?'),
    ),
);

const outdoorFix = i17.fixOutdoorIndoorLie('дома, сижу на диване', [
  { role: 'assistant', content: '[медиа:#9] кружок улица' },
]);
ok('outdoor_indoor', /старый кружок|диване/i.test(outdoorFix), `got=${outdoorFix}`);

const burst = i17.fixRobotOneWordBurst('Нечего\nЛежу\nА ты', 'что делаешь?');
ok('robot_burst', !/\n/.test(burst) || /лежу/i.test(burst), `got=${burst}`);

const height = thin.fixDirectFactAsk(
  'норм) немного утомительный, но справилась) а у тебя как?',
  'Рост у тебя какой',
  '',
);
ok('height_ask', /165|каблук/i.test(height), `got=${height}`);

const pipe = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
ok('wire_claimed_photo', /softenClaimedHerPhotoReply/.test(pipe));

const css = fs.readFileSync(path.join(__dirname, '../../frontend/styles.css'), 'utf8');
ok(
  'visual_display_font',
  /"Syne"/.test(css) && !/Space Grotesk|DM Sans|Outfit/.test(css),
);
ok('visual_no_purple_primary', !/--primary:\s*#e879c8/.test(css));
ok('visual_acid_or_warm_primary', /--primary:\s*#(b8ff3c|e8a07a)/i.test(css));

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('ALL OK');
process.exit(0);
