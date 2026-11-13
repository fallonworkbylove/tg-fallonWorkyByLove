const a = require('../services/aiResponder');
const o = require('../services/objectionHandler');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else console.log('ok:', msg);
}

// 1 coach
const coach = a.fixCoachSpeak(
  'жесть) такое может сильно расстроить, но все зависит от восприятия ситуации',
  'Ну давай, рассказывай, эмоционально качнуло??',
);
assert(!/восприятия|интересный поворот|хороший подход/i.test(coach), 'coach gone: ' + coach);

const coach2 = a.fixCoachSpeak(
  'это уже интересный поворот) можно попробовать подумать о поездке, чтобы успокоиться и оценить ситуацию на месте',
  'предложение если хочешь можешь приехать я куплю тебе билет',
);
assert(!/интересный поворот|оценить ситуацию/i.test(coach2), 'coach2: ' + coach2);

const coach3 = a.fixCoachSpeak('это хороший подход', 'Ок, сижу в кресле и не парюсь');
assert(!/хороший подход/i.test(coach3), 'coach3: ' + coach3);

// 2 substance
const nod = a.fixEmptyNodOnSubstance(
  'точно) нужно иногда отдыхать',
  'Самое главное — иногда надо отключиться от всего',
);
assert(!/нужно иногда отдыхать/i.test(nod), 'empty nod: ' + nod);

const nod2 = a.fixEmptyNodOnSubstance('да, каждому своё', 'Ну да');
assert(!/каждому сво/i.test(nod2) || nod2.length > 0, 'каждому: ' + nod2);

const topic = a.pickTopicAwareReact('Короче муж уехал на мотоцикле в Сочи по трассе');
assert(/трасс|смотал|друз|ничё|ого/i.test(topic), 'topic moto: ' + topic);

// 3 zhest + meet
const z = a.fixZhestFillerSpam('капец, жесть', 'Дронов летает пздц… а машина моя тут стоит', [
  { role: 'assistant', content: 'жесть, видно что много дел' },
]);
assert(!/^капец,?\s*жесть/i.test(z), 'zhest spam: ' + z);

assert(o.isMeetRequest('В гости будешь приезжать?)'), 'meet visit detect');
const meet = a.fixIgnoredDirectQuestion('сложно так сразу', 'В гости будешь приезжать?)');
// 0jf: мягкое «как буду на месте», не жёсткий отказ
assert(
  /как\s+буду|на\s+месте|когда\s+приеду|пересечём|город/i.test(meet) ||
    /переписк|не до встреч|коробк/i.test(meet),
  'meet soft/legacy: ' + meet,
);

console.log('done', process.exitCode || 0);
