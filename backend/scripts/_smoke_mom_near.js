process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const assert = require('assert');
const pf = require('../services/personaFacts');

const prompt =
  'Ты — Кира. Сейчас живёшь в Москве. Переезжаешь в Анапу к маме, ей нужна поддержка. Собираешь вещи.';

const bad = pf.groundReply(
  'да просто мама рядом, шумит)',
  'Кто там ходит у тебя',
  [{ role: 'assistant', content: 'ахаха, это просто соседи, гуляют)' }],
  prompt,
);
assert.ok(!/мама\s+рядом/i.test(bad), 'no mom nearby: ' + bad);
assert.ok(/сосед/i.test(bad), 'neighbors instead: ' + bad);

const bad2 = pf.groundReply('мама рядом шумит)', 'не расслышала', [], prompt);
assert.ok(!/мама\s+рядом/i.test(bad2), 'scrub mom near: ' + bad2);

console.log('smoke_mom_near OK', { bad, bad2 });
