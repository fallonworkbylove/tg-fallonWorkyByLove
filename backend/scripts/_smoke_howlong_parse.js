#!/usr/bin/env node
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_PROXY_LIST = '';
/**
 * Smoke: parseStayDays + порог отсева 21 день.
 */
const assert = require('assert');
const {
  parseStayDays,
  HOWLONG_ARCHIVE_DAYS,
  stripStayMeta,
} = require('../services/howLong');

assert.strictEqual(HOWLONG_ARCHIVE_DAYS, 21, 'порог 21');

const cases = [
  ['месяц', 30],
  ['Месяц', 30],
  ['пару недель', 14],
  ['Пару недель висит анкета', 14],
  ['три недели', 21],
  ['3 недели', 21],
  ['неделю', 7],
  ['Неделю', 7],
  ['Год где то', 365],
  ['5', 5],
  ['20', 20],
  ['Два а что', 2],
  ['1 день😂😂😂', 1],
  ['Дней 7', 7],
  ['3 дня', 3],
  ['Да пару дней где-то, а ты?', 2],
  ['Первый день😁', 1],
  ['Недавно', 5],
  ['Да только вот зарегался )', 1],
  ['Вчера ночью только', 1],
  ['Давно уже', 60],
  ['Вообще давно уже', 60],
  ['Давно уже', 60],
  ['достаточно', 60],
  ['Прилично', 60],
  ['Да недолго', 3],
  ['не знаю, много, как пришел служить', 60],
  ['[уточнение к твоей фразе «а скок ты уже дней на дв?»]: Неделю', 7],
  ['[уточнение к твоей фразе «а скок ты уже дней на дв?»]: Пару недель висит анкета', 14],
  ['[уточнение к твоей фразе «слушай, а ты скок дней уже сидишь на дв?»]: Может месяц', 30],
  ['[уточнение к твоей фразе «а скок ты уже дней на дв?»]: Несколько месяцев', 90],
  ['Несколько месяцев', 90],
  ['полгода', 180],
  ['с лета', 90],
  ['Покажи себя', null],
  ['Я не знаю', null],
  ['Учёба 5 лет', null],
  ['мне 25 лет', null],
];

let fail = 0;
for (const [text, want] of cases) {
  const got = parseStayDays(text);
  const ok = got === want;
  if (!ok) {
    fail += 1;
    console.error('FAIL', JSON.stringify(text), '→', got, 'want', want);
  }
}

assert.ok(stripStayMeta('[уточнение]: [Голосовое]: месяц').toLowerCase().includes('месяц'));

const archive = (t) => {
  const d = parseStayDays(t);
  return d != null && d >= HOWLONG_ARCHIVE_DAYS;
};
assert.strictEqual(archive('три недели'), true);
assert.strictEqual(archive('пару недель'), false);
assert.strictEqual(archive('месяц'), true);
assert.strictEqual(archive('14 дней'), false);
assert.strictEqual(archive('21'), true);
assert.strictEqual(archive('20'), false);

if (fail) {
  console.error(`SMOKE_HOWLONG_PARSE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_HOWLONG_PARSE_OK', cases.length);
