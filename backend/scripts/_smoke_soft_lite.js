#!/usr/bin/env node
const soft = require('../services/softHumanLite');

const histSilent = [
  { role: 'assistant', content: 'ещё в липецке)' },
  { role: 'user', content: 'а работа?' },
  { role: 'assistant', content: 'флипинг токенов)' },
  { role: 'user', content: 'живешь в липецке?' },
  { role: 'assistant', content: 'да, щас тут' },
];

let fail = 0;

function check(name, ok) {
  console.log(ok ? 'OK' : 'FAIL', name);
  if (!ok) fail += 1;
}

check(
  'needs after 3 silent',
  soft.needsReciprocalQuestion(histSilent, 'А ты у меня ничего не будешь спрашивать?') === true,
);
check(
  'needs after silent no q',
  soft.needsReciprocalQuestion(histSilent, 'понял)') === true,
);
check(
  'no need if she asked',
  soft.needsReciprocalQuestion(
    [...histSilent, { role: 'assistant', content: 'а ты как день?' }],
    'норм',
  ) === false,
);
check(
  'no need on multi q from him',
  soft.needsReciprocalQuestion(histSilent.slice(0, 2), 'где ты? чем занимаешься?') === false,
);

const ensured = soft.ensureReciprocalQuestion('да, щас в Липецке)', histSilent, 'понял)');
check('ensure adds ?', /\?/.test(ensured) && ensured.includes('Липецке'));

const kept = soft.applySoftLite('да, щас тут) а ты как день?', histSilent, 'понял)');
check('keep existing q', /\?/.test(kept));

const coach = soft.applySoftLite('не переживай, все будет ок', [], 'привет');
check('coach still soft', !/вс[её]\s+будет/i.test(coach));

const ladno = soft.fixAwkwardLadnoPredicate('о, малыш) молодость - это ладно');
check('no это ладно', !/это\s+ладно/i.test(ladno) && /молодость/i.test(ladno));
console.log('  ladno→', ladno);
const ladno2 = soft.applySoftLite('о, малыш) молодость - это ладно', [], 'мне 19');
check('soft lite strips ладно', !/это\s+ладно/i.test(ladno2));

const nuOkCases = [
  'на Байкале просто ну ок',
  'сериалы - это ну ок, особенно после работы',
  'о, Мальта - ну ок) как там?',
  'день ну ок сегодня)',
  'довольно ну ок',
  'в Анапе, наверное, ну ок гулять',
  'приветик) ну ок, что ты здесь',
  'мазда, ну ок',
];
for (const raw of nuOkCases) {
  const fixed = soft.fixAwkwardNuOkPredicate(raw);
  const viaSoft = soft.applySoftLite(raw, [], 'тест');
  const bad =
    /это\s+ну\s+ок|просто\s+ну\s+ок|довольно\s+ну\s+ок|ну\s+ок\s+гулять|-\s*ну\s+ок(?![а-яё])|ну\s+ок,\s*что/i.test(
      fixed,
    ) ||
    /это\s+ну\s+ок|просто\s+ну\s+ок|довольно\s+ну\s+ок/i.test(viaSoft);
  check(`nuOk: ${raw.slice(0, 28)}`, !bad);
  if (bad) console.log('  got→', fixed, '|', viaSoft);
}
const keepAck = soft.fixAwkwardNuOkPredicate('хах ну ок)');
check('keep bare ну ок', /^хах\s+ну\s+ок\)?$/i.test(keepAck.trim()));

// stripQuestionTags без полного replyPipeline (openai)
const stripQ = (t) =>
  String(t || '')
    .replace(/<<\s*Q\s*:\s*([\d,]+)\s*>>\s*/gi, '')
    .replace(/<<\s*>>/g, '')
    .replace(/<<(?!\s*Q\s*:)[^>]{0,40}>>/gi, '')
    .trim();
check('strip empty <<>>', !/<<>>/.test(stripQ('подожди немного <<>>')));

const noLink = soft.stripEmptyTogetherInvite(
  'кстати, сегодня залетела на платформу, там новая коллекция выходит, может вместе глянем? я уже присматриваю))',
);
check('strip glynem', !/глянем/i.test(noLink) && /присматриваю/i.test(noLink));

const hint = soft.softHint([], 'что угодно');
check(
  'general hint',
  /живая\s+девушк|с телефона/i.test(hint) &&
    /NFT|токен/i.test(hint) &&
    /это ну ок|ну ок\)/i.test(hint),
);

const dvHist = [
  { role: 'user', content: 'Привет! Я с Дайвинчика ✨' },
  { role: 'assistant', content: 'приветик) рада видеть тебя здесь)' },
  { role: 'user', content: 'Ты в Белгороде ?' },
  { role: 'assistant', content: 'пока в Липецке)' },
];
check(
  'dating site ask',
  soft.isDatingSiteAsk(dvHist, 'На сайте что-то конкретно ищешь ?') === true,
);
check(
  'not dating when crypto',
  soft.isDatingSiteAsk(dvHist, 'на сайте нфт что ищешь?') === false,
);
const siteHint = soft.softHint(dvHist, 'На сайте что-то конкретно ищешь ?');
check('site hint blocks nft', /знакомств|НЕ про NFT/i.test(siteHint));

console.log(fail ? `SOFT_LITE_FAIL ${fail}` : 'SOFT_LITE_OK');
process.exit(fail ? 1 : 0);
