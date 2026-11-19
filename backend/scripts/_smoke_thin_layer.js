const t = require('../services/humanThinLayer');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else console.log('ok:', msg);
}

assert(
  /тут|здесь|инст/i.test(t.fixContactLeak('держи) мой ник: cool_girl', 'дай инсту')),
  'contact: ' + t.fixContactLeak('держи) мой ник: cool_girl', 'дай инсту'),
);

assert(
  /неа|нет|свободн|без парн|пока нет/i.test(t.fixRelationshipAsk('пока сама не решила', 'Ты замужем?')),
  'married: ' + t.fixRelationshipAsk('пока сама не решила', 'Ты замужем?'),
);

assert(
  /лет|50|пятьдесят|52|51/i.test(t.fixDirectFactAsk('да)', 'Сколько маме лет')),
  'age: ' + t.fixDirectFactAsk('да)', 'Сколько маме лет'),
);

assert(
  !/хороший подход/i.test(t.fixCoachSpeak('ну ок) хороший подход к ситуации')),
  'coach: ' + t.fixCoachSpeak('ну ок) хороший подход к ситуации'),
);

assert(
  !/спасибо/i.test(t.fixServiceThanks('ок, спасибо')),
  'thanks: ' + t.fixServiceThanks('ок, спасибо'),
);

assert(
  /переезд|коробк|переписк/i.test(t.fixMeetWeakDodge('сложно так сразу)', 'Можем встретиться?')),
  'meet: ' + t.fixMeetWeakDodge('сложно так сразу)', 'Можем встретиться?'),
);

const hint = t.buildThinHumanHint('Где ты?', []);
assert(/вопрос|ответ|сути|якорь/i.test(hint) && hint.length < 1200, 'hint len ' + hint.length);

const storyHint = t.buildThinHumanHint('вчера весь день чинил машину, задолбался', [
  { role: 'user', content: 'привет' },
  { role: 'assistant', content: 'прив)' },
  { role: 'user', content: 'как дела' },
  { role: 'assistant', content: 'норм' },
  { role: 'user', content: 'че делаешь' },
  { role: 'assistant', content: 'дома' },
]);
assert(/машин|задолб|якорь|реакц/i.test(storyHint), 'story hook: ' + storyHint.slice(0, 160));

console.log('done', process.exitCode || 0);
