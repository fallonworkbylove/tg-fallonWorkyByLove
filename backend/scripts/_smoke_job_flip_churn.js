#!/usr/bin/env node
/**
 * Hard smoke: job→flip+слышал + day1 soft + repeat strip + churn.
 */
const jobFlip = require('../services/jobFlipAsk');
const churn = require('../services/churnLearn');
const hh = require('../services/humanHardening');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

// --- job occupation detect ---
check('job: кем работаешь', jobFlip.isJobOccupationAsk('а кем ты работаешь?'));
check('job: чем занимаешься', jobFlip.isJobOccupationAsk('чем занимаешься?'));
check('job: where do you work', jobFlip.isJobOccupationAsk('where do you work?'));
check('not day: чем занята', !jobFlip.isJobOccupationAsk('чем занята?'));
check('not day: что делаешь', !jobFlip.isJobOccupationAsk('что делаешь?'));
check('not explain flip', !jobFlip.isJobOccupationAsk('а что такое флип?'));

// --- day1 gate ---
check('mayFlip day2', jobFlip.mayMentionFlipNft({ ageHours: 30 }));
check('noFlip day1 age', !jobFlip.mayMentionFlipNft({ ageHours: 5 }));
check('noFlip short hist', !jobFlip.mayMentionFlipNft({ history: [{ role: 'user', content: 'hi' }] }));
check(
  'mayFlip long hist no age',
  jobFlip.mayMentionFlipNft({
    history: Array.from({ length: 10 }, () => ({ role: 'user', content: 'x' })),
  }),
);

const day1 = jobFlip.ensureJobFlipHeardAsk('онлайн, гибкий график)', 'кем работаешь?', {
  ageHours: 3,
});
check('day1 soft no flip', !jobFlip.FLIP_MARK_RE.test(day1) && /онлайн|гибк|сама/i.test(day1), day1);
check('day1 no heard', !jobFlip.HEARD_RE.test(day1), day1);

const day1leak = jobFlip.ensureJobFlipHeardAsk('флипаю токены онлайн) слышал о таком?)', 'чем занимаешься?', {
  ageHours: 2,
});
check('day1 strips leak', !jobFlip.FLIP_MARK_RE.test(day1leak), day1leak);

const hint1 = jobFlip.jobFlipHint('кем работаешь?', { ageHours: 1 });
check(
  'hint day1 soft',
  !!hint1 && /Рано для флипа/i.test(hint1) && /ЗАПРЕЩЕНО:.*флип/i.test(hint1),
  hint1 && hint1.slice(0, 120),
);

// --- ensure flip + heard (day2+) ---
const fixed = jobFlip.ensureJobFlipHeardAsk('онлайн, гибкий график)', 'кем работаешь?', {
  ageHours: 48,
});
check('ensure has flip', jobFlip.FLIP_MARK_RE.test(fixed), fixed);
check('ensure has heard', jobFlip.HEARD_RE.test(fixed), fixed);
check('ensure has ?', /\?/.test(fixed), fixed);

const keep = jobFlip.ensureJobFlipHeardAsk(
  'флипаю токены онлайн) слышал о таком?)',
  'чем занимаешься?',
  { ageHours: 48 },
);
check('idempotent keep', /флип/i.test(keep) && /слышал/i.test(keep), keep);

const append = jobFlip.ensureJobFlipHeardAsk('удалённо токены флипаю)', 'ты работаешь?', {
  ageHours: 48,
});
check('append heard only', /флип/i.test(append) && jobFlip.HEARD_RE.test(append), append);

const dayKeep = jobFlip.ensureJobFlipHeardAsk('кофе пью)', 'чем занята?');
check('day untouched', dayKeep === 'кофе пью)', dayKeep);

const hint = jobFlip.jobFlipHint('кем работаешь?', { ageHours: 48 });
check('hint present', !!hint && /слышал/i.test(hint) && /флип/i.test(hint));
check('hint null on day', jobFlip.jobFlipHint('как дела?') == null);

// --- repeat flip in hobbies ---
const histTold = [
  { role: 'assistant', content: 'я занимаюсь флипингом токенов, онлайн' },
  { role: 'user', content: 'ок' },
];
const hobbies = hh.stripRepeatFlipPitch(
  'я люблю кофе, сериалы и иногда гулять) ещё флиппингом занимаюсь, но это так, подработка',
  histTold,
  'Про свои хобби тоже расскажи)',
);
check('strip hobby flip repeat', !/флип/i.test(hobbies), hobbies);

// --- churn classify ---
check(
  'churn nft',
  churn.classifyChurnReason([
    { role: 'user', content: 'чем занимаешься?' },
    { role: 'assistant', content: 'флипаю токены) слышал о таком?)' },
  ]) === 'after_nft_pitch',
);
check(
  'churn bot',
  churn.classifyChurnReason([
    { role: 'user', content: 'ты бот что ли' },
    { role: 'assistant', content: 'хах ну ты серьёзно)' },
  ]) === 'after_bot_accusation',
);
check(
  'churn meet',
  churn.classifyChurnReason([
    { role: 'user', content: 'давай встретимся на кофе' },
    { role: 'assistant', content: 'ой пока не до встреч, только переписка)' },
  ]) === 'after_meet_refuse',
);
check(
  'churn contact',
  churn.classifyChurnReason([
    { role: 'user', content: 'скинь инсту' },
    { role: 'assistant', content: 'инсту не кидаю, давай тут)' },
  ]) === 'after_contact_refuse',
);

if (fail) {
  console.error(`${fail} failed`);
  process.exit(1);
}
console.log('ALL PASS');
