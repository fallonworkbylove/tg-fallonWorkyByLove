const a = require('../services/aiResponder');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else console.log('ok:', msg);
}

const married = a.fixLiveLogBugs('пока сама не решила', 'Ты замужем?', [], 'ru');
assert(/неа|нет|свободн|без парн|пока нет/i.test(married), 'married: ' + married);

const how = a.fixLiveLogBugs('короче потом расскажу', 'Как это?', [
  { role: 'user', content: 'Ты замужем?' },
  { role: 'assistant', content: 'пока сама не решила' },
], 'ru');
assert(/нет парня|свободн|неа|без отношен/i.test(how), 'how: ' + how);

const deepen = a.fixLiveLogBugs('не знаю, не хочу углубляться', 'Сейчас расскажи', [
  { role: 'user', content: 'Ты замужем?' },
], 'ru');
assert(/нет парня|свободн|неа|без отношен/i.test(deepen), 'deepen: ' + deepen);

const please = a.fixLiveLogBugs(
  'не совсем поняла, что имеешь в виду) уточни, пожалуйста',
  'Как ты меня просила зайти',
  [],
  'ru',
);
assert(!/пожалуйста|имеешь в виду/i.test(please), 'please: ' + please);

const hedge = a.fixLiveLogBugs(
  'это такие токены, которые можно перепродавать) довольно ну ок',
  'Это что?',
  [],
  'ru',
);
assert(!/довольно ну ок/i.test(hedge), 'hedge: ' + hedge);

const thanks = a.fixLiveLogBugs('ок, спасибо', 'ладно', [], 'ru');
assert(!/спасибо/i.test(thanks), 'thanks: ' + thanks);

const joke = a.fixEditorialTone('хах, ну ты шутник)', 'взломала бы телегу');
assert(!/шутник/i.test(joke), 'шутник: ' + joke);

const ignored = a.fixIgnoredDirectQuestion('ага)', 'Ты замужем?');
assert(/неа|нет|свободн|без парн|пока нет/i.test(ignored), 'ignored married: ' + ignored);

console.log('done', process.exitCode || 0);
