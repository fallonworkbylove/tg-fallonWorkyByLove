#!/usr/bin/env node
/**
 * Smoke: после «доброй ночи» / farewell не дописываем «чем занят?».
 */
const soft = require('../services/softHumanLite');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else console.log('ok', msg);
}

const hist = [
  { role: 'assistant', content: 'ок)' },
  { role: 'assistant', content: 'хм, да, уже поздновато)' },
  { role: 'assistant', content: 'ага, постараюсь не засиживаться)' },
];

assert(
  soft.needsReciprocalQuestion(hist, 'Доброй ночи') === false,
  'no reciprocal on Доброй ночи',
);
assert(
  soft.needsReciprocalQuestion(hist, 'А я наверно спать 😴') === false,
  'no reciprocal on иду спать',
);
assert(
  soft.needsReciprocalQuestion(hist, 'Умничка\nДоброй ночи') === false,
  'no reciprocal on Умничка+ночи',
);

const forced = soft.ensureReciprocalQuestion(
  'спокойной ночи, сладких снов)',
  hist,
  'ну ок, пойду дальше работаю весь вечер',
);
assert(!/\?/.test(forced), 'farewell reply not appended: ' + forced);

const stripped = soft.stripQuestionAfterFarewell(
  'спокойной ночи, сладких снов чем сейчас занят?',
);
assert(
  /спокойной|сладких/i.test(stripped) && !/занят/i.test(stripped),
  'strip after farewell: ' + stripped,
);

const lite = soft.applySoftLite(
  'спокойной ночи, сладких снов)',
  hist,
  'Доброй ночи',
);
assert(!/\?/.test(lite), 'applySoftLite clean: ' + lite);

console.log('GOODNIGHT_Q', process.exitCode ? 'FAIL' : 'OK');
process.exit(process.exitCode || 0);
