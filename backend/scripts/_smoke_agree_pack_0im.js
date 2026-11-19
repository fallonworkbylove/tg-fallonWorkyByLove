/**
 * A–G pack: anti-agree / поняла / greeting / early fly / social / wiring.
 */
const i15 = require('../services/humanIdeas15');
const pf = require('../services/personaFacts');
const fs = require('fs');
const path = require('path');

let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('OK', name);
  else {
    fail++;
    console.log('FAIL', name, detail);
  }
}

// A
const agree = i15.stripOverAgree('да, да, так и есть', 'Ты на этом и зарабатываешь');
ok('A_no_double_da', !/^да,\s*да/i.test(agree), agree);
ok('A_not_same', agree !== 'да, да, так и есть', agree);

const agree2 = i15.stripOverAgree('да, это точно) но сейчас не получится', 'Мы бы хорошо провели время');
ok('A_strip_da_tochno', !/^да,\s*это\s+точно/i.test(agree2), agree2);

// B
const pon = i15.expandPonialaOnSubstance('ага, поняла', 'Собираюсь домой');
ok('B_not_poniala', !/поняла/i.test(pon) || pon.length > 20, pon);

const pon2 = i15.expandPonialaOnSubstance('ну поняла)', 'Плохо');
ok('B_bad_not_bare', !/^ну\s+поняла\)?$/i.test(pon2), pon2);

// C
const greet = i15.fixGreetingAck('ага, ясно)', 'Привет!)');
ok('C_greet', /привет|хай/i.test(greet), greet);

const q = i15.fixGreetingAck('хех, ясно)', '?');
ok('C_q', !/ясно/i.test(q), q);

// D
const fly = i15.stripEarlyArrive(
  'да, улетела) уже в пути, скоро в Амурск',
  'Улетела?',
  'Ты — Вика. Сейчас живёшь в Липецке, через пару недель переезжаешь в Амурск к маме.',
);
ok('D_no_fly', !/улетел|в пути/i.test(fly), fly);

const grounded = pf.groundReply(
  'да, улетела) уже в пути',
  'Улетела?',
  [],
  'Ты живёшь в Липецке, переезжаешь в Тимашевск к маме.',
);
ok('D_ground', !/улетел|в пути/i.test(grounded), grounded);

// E
const soc = i15.softSocialHackRefuse('не, не даю пок)', 'ВК так и не дашь?');
ok('E_hack', /взлом/i.test(soc), soc);

// wiring
const hh = fs.readFileSync(path.join(__dirname, '../services/humanHardening.js'), 'utf8');
ok('wire_ideas15', /humanIdeas15/.test(hh));
ok('wire_prompt_arg', /systemPrompt/.test(hh) && /applyIdeas15Postfilters/.test(hh));

const css = fs.readFileSync(path.join(__dirname, '../../frontend/styles.css'), 'utf8');
ok('G_accounts_overflow', /accounts-table-wrap[\s\S]{0,120}overflow-x:\s*hidden/.test(css));

const rp = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
ok('F_voice_gap_3h', /VOICE_REPEAT_GAP_MS\s*=\s*3\s*\*\s*60\s*\*\s*60/.test(rp));

const oh = fs.readFileSync(path.join(__dirname, '../services/objectionHandler.js'), 'utf8');
ok('E_hint_hack', /взломали/.test(oh));
ok('F_silence_dedupe', /wasVoiceSent[\s\S]{0,80}SILENCE_VOICE_FILE/.test(oh));

if (fail) {
  console.log('FAIL_TOTAL', fail);
  process.exit(1);
}
console.log('ALL_OK');
process.exit(0);
