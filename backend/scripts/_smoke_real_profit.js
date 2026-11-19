process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'local-smoke-only';
const a = require('../services/aiResponder');

const hist = [
  { role: 'user', content: 'На что уже нафлипила?!' },
  { role: 'assistant', content: 'ну, разные токены, не запоминаю' },
];

const cases = [
  ['из реального пока только кофе)', 'А из реального?', hist],
  ['да, кофе - это святое', 'Этим все сказано)', hist],
  ['оплатила ипотеку родным за год)', 'а из реального?', hist],
  ['меня зовут Кира)', 'Моя госпожа?!', []],
];

for (const [r, u, h] of cases) {
  let out = a.fixIgnoredNameQuestion(r, u, 'Тебя зовут Кира');
  out = a.fixRealProfitAnswer(out, u, h, 'ru');
  console.log(JSON.stringify(u), '|', JSON.stringify(r), '=>', JSON.stringify(out));
}
console.log('hint', a.buildRealProfitHint('А из реального?', hist));
