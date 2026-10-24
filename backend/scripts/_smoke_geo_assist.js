#!/usr/bin/env node
/**
 * Smoke: «А давно в Краснодаре?» без «а ты там живёшь?» + отказ от generate-текста.
 */
require('dotenv').config();
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-test-smoke';

const ar = require('../services/aiResponder');
const oh = require('../services/objectionHandler');
const thin = require('../services/humanThinLayer');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else console.log('ok', msg);
}

const prompt = 'Ты живёшь в Краснодаре, переезжаешь в Сочи к маме.';
const hist = [{ role: 'assistant', content: 'ну да, сейчас в Краснодаре живу)' }];

const asked = ar.extractAskedCityAboutHer('А давно в Краснодаре?');
assert(asked && /краснодар/i.test(asked.city), 'extract city: ' + JSON.stringify(asked));

const mirrored = ar.fixFalseHisCityMirror(
  'не, в Краснодаре не была никогда) как-то не довелось ещё побывать. а ты давно там живёшь?',
  'А давно в Краснодаре?',
  hist,
  prompt,
);
assert(
  !/а\s+ты\s+давно/i.test(mirrored) && !/не\s+была\s+никогда/i.test(mirrored),
  'no deny+mirror: ' + mirrored,
);

const clarifyHist = [
  ...hist,
  {
    role: 'assistant',
    content: 'не, в Краснодаре не была) а ты давно там живёшь?',
  },
];
const clarify = ar.fixFalseHisCityMirror(
  'да, в Краснодаре',
  'В Краснодаре?',
  clarifyHist,
  prompt,
);
assert(!/^да,?\s*в\s+краснодар/i.test(clarify), 'no affirm his city: ' + clarify);

const hint = oh.detectHint('А давно в Краснодаре?', hist);
assert(/ЗАПРЕЩЕНО.*а ты давно там/i.test(String(hint || '')), 'city hint');

const genHint = oh.detectHint('Сгенерируй текст поздравления друга со свадьбой', []);
assert(/НЕ ассистент|не нейросеть|ChatGPT/i.test(String(genHint || '')), 'gen hint');

const genFix = thin.fixAiAssistantMode(
  'можно так: «Дорогой [имя], поздравляю тебя со свадьбой, желаю счастья, любви и гармонии в вашем новом пути.»',
  'Сгенерируй текст поздравления друга со свадьбой',
);
assert(!/дорогой|можно так/i.test(genFix) && genFix.length < 80, 'gen refusal: ' + genFix);

console.log('GEO_ASSIST', process.exitCode ? 'FAIL' : 'OK');
process.exit(process.exitCode || 0);
