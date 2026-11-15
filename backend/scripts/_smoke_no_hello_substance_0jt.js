/**
 * Smoke 0jt: на «что делаешь / выходные» нельзя голое «привет)».
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const soft = require('../services/softHumanLite');
const { finalizeOutgoingReply } = require('../services/aiResponderPostprocess');

const assert = (c, m) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('OK', m);
};

const weekend = soft.fixBareGreetingOnSubstance('привет)', 'Что делаешь? Как выходные?');
assert(weekend && !/^привет\s*\)?$/i.test(weekend.trim()), 'weekend not bare hello');
assert(/дома|выходн|вожусь|мелоч|норм|рассказ|слушаю|подробн/i.test(weekend), 'weekend substance');

const chem = soft.fixBareGreetingOnSubstance('хай)', 'а чем ты?');
assert(!/^хай\s*\)?$/i.test(chem.trim()), 'chem not хай');

const mood = soft.fixBareGreetingOnSubstance('ну привет)', 'Как настроение?)');
assert(!/привет/i.test(mood), 'mood no привет');

const okHello = soft.fixBareGreetingOnSubstance('привет)', 'Привет)');
assert(/^привет\s*\)?$/i.test(okHello.trim()), 'echo hello kept');

const fin = finalizeOutgoingReply('привет)', 'Что делаешь? Как выходные?');
assert(!/^привет\s*\)?$/i.test(String(fin).trim()), 'finalize strips hello on substance');

console.log(process.exitCode ? 'SMOKE_FAIL' : 'SMOKE_NO_HELLO_SUBSTANCE_0JT_OK');
process.exit(process.exitCode || 0);
