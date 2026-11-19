/**
 * Юнит-тесты фиксов анти-детекта (по жалобе собеседника «бот как будто печатает»
 * и «странно как-то ты общаешься»).
 *
 * Запуск: node scripts/_antidetect_reply_test.js
 */
const assert = require('assert');
const ai = require('../services/aiResponder');

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('BOT_ACCUSATION — распознавание жалоб со скрина:');
ok('«Странно как то ты общаешься» ловится', () => {
  assert.strictEqual(ai.recentUserBotAccusation([], 'Странно как то ты общаешься'), true);
});
ok('«странно общаешься» ловится', () => {
  assert.strictEqual(ai.recentUserBotAccusation([], 'странно общаешься'), true);
});
ok('«Бот как будто печатает» ловится', () => {
  assert.strictEqual(ai.recentUserBotAccusation([], 'Бот как будто печатает'), true);
});
ok('«как будто бот печатает» ловится', () => {
  assert.strictEqual(ai.recentUserBotAccusation([], 'как будто бот печатает'), true);
});
ok('обычный флирт НЕ считается обвинением', () => {
  assert.strictEqual(ai.recentUserBotAccusation([], 'ты красивая'), false);
});
ok('вопрос про дела НЕ считается обвинением', () => {
  assert.strictEqual(ai.recentUserBotAccusation([], 'как дела?'), false);
});

console.log('\nHUMANIZE BOT ACCUSATION — живой короткий ответ:');
ok('на «странно общаешься» уходит живая реакция, не саппорт', () => {
  const out = ai.humanizeBotAccusationReply('Извини, я просто общаюсь как могу', [], 'странно ты общаешься');
  assert.ok(out.length > 0, 'пустой ответ');
  assert.ok(!/общаюсь как могу|не переживай|всё нормально/i.test(out), `саппорт-скрипт: ${out}`);
  assert.ok(out.length <= 30, `слишком длинно: ${out}`);
});
ok('на «бот как будто печатает» нет оправданий', () => {
  const out = ai.humanizeBotAccusationReply('я живой человек, не бот', [], 'бот как будто печатает');
  assert.ok(!/живой человек|не бот|обидно/i.test(out), `оправдание: ${out}`);
});

console.log('\nCONFUSED SCRIPT — «не совсем поняла» на нейтральную реплику:');
ok('«Это хорошо» + «не совсем поняла» → продолжение, не бот-скрипт', () => {
  const out = ai.fixConfusedScript('не совсем поняла', 'Это хорошо', []);
  assert.ok(!/не совсем поняла|не поняла|не шарю/i.test(out), `остался скрипт: ${out}`);
  assert.ok(out.length > 0);
});
ok('«Это хорошо» + «не расслышала)» → продолжение', () => {
  const out = ai.fixConfusedScript('не расслышала)', 'Это хорошо', []);
  assert.ok(!/не расслышала|не поняла/i.test(out), `остался скрипт: ${out}`);
});
ok('реальный вопрос про NFT не режется', () => {
  const out = ai.fixConfusedScript('не шарю если честно)', 'что такое NFT?', []);
  assert.ok(out.length > 0);
});

console.log('\nTYPING — длительность «печатает...» от длины текста:');
const { computeTypingMs } = require('../services/telegramClient');
ok('короткое «ок)» печатается < 3.5с, а не 5с минимум', () => {
  for (let i = 0; i < 20; i += 1) {
    const ms = computeTypingMs('ок)');
    assert.ok(ms < 3500, `слишком долго для «ок)»: ${ms}мс`);
    assert.ok(ms >= 900, `слишком мгновенно: ${ms}мс`);
  }
});
ok('«да, все хорошо)» печатается < 4с', () => {
  for (let i = 0; i < 20; i += 1) {
    const ms = computeTypingMs('да, все хорошо)');
    assert.ok(ms < 4000, `слишком долго: ${ms}мс`);
  }
});
ok('длинный абзац печатается заметно дольше короткого', () => {
  const short = computeTypingMs('ок)');
  const long = computeTypingMs('я сегодня просто день так провела, смотрела сериалы и слушала музыку');
  assert.ok(long > short, `длинный ${long} должен быть > короткого ${short}`);
});
ok('реакция <<REACT:😂>> не считается текстом', () => {
  const ms = computeTypingMs('<<REACT:😂>>');
  assert.ok(ms < 2000, `реакция не должна печататься долго: ${ms}мс`);
});

console.log(`\n${passed} тестов пройдено${process.exitCode ? ' (есть падения)' : ''}.`);
