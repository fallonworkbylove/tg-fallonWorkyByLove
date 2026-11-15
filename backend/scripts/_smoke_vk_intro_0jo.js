#!/usr/bin/env node
'use strict';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const i15 = require('../services/humanIdeas15');
const obj = require('../services/objectionHandler');
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail);
  }
}

ok('intro_oleg', !i15.looksLikeSocialContactAsk('Олег из вк'));
ok('intro_ya', !i15.looksLikeSocialContactAsk('я из вк)'));
ok('intro_s_inst', !i15.looksLikeSocialContactAsk('привет я с инсты'));
ok('ask_vk', i15.looksLikeSocialContactAsk('дай вк'));
ok('ask_vk2', i15.looksLikeSocialContactAsk('ВК так и не дашь?'));
ok('ask_inst', i15.looksLikeSocialContactAsk('скинь инст'));

const kept = i15.softSocialHackRefuse('привет) ты откуда?)', 'Олег из вк');
ok('post_keep', kept === 'привет) ты откуда?)', kept);

const refused = i15.softSocialHackRefuse('не даю)', 'дай вк');
ok('post_refuse', /взлом|телег/i.test(refused), refused);

const hintsIntro = i15.buildIdeas15Hints('Олег из вк');
ok('hint_intro', /НЕ просьба/i.test(hintsIntro) && !/Просит ВК/i.test(hintsIntro));

const hintsAsk = i15.buildIdeas15Hints('дай вк');
ok('hint_ask', /Просит ВК/i.test(hintsAsk));

ok('obj_intro', !obj.isContactRequest('Олег из вк'));
ok('obj_ask', obj.isContactRequest('дай вк'));
ok('obj_meet_intro', !obj.isContactOrMeetRelated('Олег из вк'));

if (fail) {
  console.error('SMOKE_0JO_FAIL', fail);
  process.exit(1);
}
console.log('ALL_OK_0jo');
process.exit(0);
