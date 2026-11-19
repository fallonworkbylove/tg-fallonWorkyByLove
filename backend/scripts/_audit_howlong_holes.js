#!/usr/bin/env node
/**
 * Дыры howlong: фразы из логов → parse + порог 21.
 */
const { parseStayDays, HOWLONG_ARCHIVE_DAYS } = require('../services/howLong');

const fromLogs = [
  // должны → отсев
  ['месяц', true],
  ['Месяц', true],
  ['Несколько месяцев', true],
  ['Год где то', true],
  ['Давно уже', true],
  ['Вообще давно уже', true],
  ['три недели', true],
  ['3 недели', true],
  ['21', true],
  ['30', true],
  ['полгода', true],
  ['с лета', true],
  ['прилично', true],
  ['достаточно', true],
  // НЕ отсев
  ['пару недель', false],
  ['две недели', false],
  ['неделю', false],
  ['14', false],
  ['20', false],
  ['Два а что', false],
  ['5', false],
  ['3 дня', false],
  ['Недавно', false],
  ['Да недолго', false],
  ['Первый день😁', false],
  ['Да только вот зарегался )', false],
  // null — не архив (дырa только если ложно ≥21)
  ['Покажи себя', false],
  ['Я не знаю', false],
  ['а ты откуда?', false],
];

let holes = 0;
const rows = [];
for (const [text, wantArchive] of fromLogs) {
  const d = parseStayDays(text);
  const arch = d != null && d >= HOWLONG_ARCHIVE_DAYS;
  const ok = arch === wantArchive;
  if (!ok) holes += 1;
  rows.push({ text, days: d, arch, wantArchive, ok });
}

// Ложные срабатывания: ответы не про срок, но parse дал ≥21
const falsePos = [
  'Учёба 5 лет',
  'мне 25 лет',
  'Работал на легке,сейчас отдыхаю',
  'Покажи себя',
  'как дела',
];
for (const text of falsePos) {
  const d = parseStayDays(text);
  const arch = d != null && d >= HOWLONG_ARCHIVE_DAYS;
  rows.push({ text, days: d, arch, wantArchive: false, ok: !arch, note: 'falsePos-check' });
  if (arch) holes += 1;
}

console.log(JSON.stringify({ HOWLONG_ARCHIVE_DAYS, holes, sample: rows.filter((r) => !r.ok) }, null, 2));
if (holes) {
  console.error('HOLES', holes);
  process.exit(1);
}
console.log('HOWLONG_HOLES_OK');
