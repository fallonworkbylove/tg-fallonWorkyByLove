const a = require('../services/aiResponder');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else console.log('ok:', msg);
}

const age = a.fixIgnoredDirectQuestion('да)', 'Сколько маме лет если не секрет');
assert(/лет|50|пятьдесят|52|51/i.test(age) && !/^да/i.test(age), 'mom age: ' + age);

const bouquet = a.fixIgnoredDirectQuestion('жесть, прикольно', 'Откуда букетик');
assert(/сама|рынка|подруга|купила|взяла/i.test(bouquet), 'bouquet: ' + bouquet);

const say = a.fixIgnoredDirectQuestion('ага, потом', 'Ну так скажешь ?', 'ru', [
  { role: 'user', content: 'Откуда букетик' },
]);
assert(/сама|рынка|подруга|купила|взяла/i.test(say), 'скажешь: ' + say);

const farewell = a.fixIgnoredDirectQuestion('ага', 'Прощальный букет ?');
assert(!/^ага\s*\)?$/i.test(farewell), 'farewell: ' + farewell);

console.log('done', process.exitCode || 0);
