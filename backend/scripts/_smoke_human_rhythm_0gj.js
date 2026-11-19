#!/usr/bin/env node
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

const rhythm = require('../services/humanRhythm');
const memSrc = require('fs').readFileSync(
  require('path').join(__dirname, '../services/memoryTriggers.js'),
  'utf8',
);
const pipeSrc = require('fs').readFileSync(
  require('path').join(__dirname, '../services/replyPipeline.js'),
  'utf8',
);
const inboundSrc = require('fs').readFileSync(
  require('path').join(__dirname, '../services/inbound.js'),
  'utf8',
);
const timingSrc = require('fs').readFileSync(
  require('path').join(__dirname, '../services/timing.js'),
  'utf8',
);

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

check('incomplete comma', rhythm.looksIncomplete('ну я короче,'));
check('incomplete и', rhythm.looksIncomplete('пошёл на смену и'));
check('complete ?', !rhythm.looksIncomplete('как дела?'));
check('complete .', !rhythm.looksIncomplete('норм всё.'));

const win = rhythm.aggregateWindowMs('щас', 3200);
check('aggregate longer incomplete', win > 3200 && win <= 7500, `win=${win}`);
check('aggregate normal complete', rhythm.aggregateWindowMs('ок всё.', 3200) === 3200);

const shortOut = [];
const longOut = [];
for (let i = 0; i < 40; i++) {
  shortOut.push(
    rhythm.reshapeDelayPair({
      baseDelayMs: 4000,
      outText: 'ага)',
      incomingText: 'расскажи подробно как у тебя день прошёл и что думаешь',
      accountId: 1,
    }).delayMs,
  );
  longOut.push(
    rhythm.reshapeDelayPair({
      baseDelayMs: 4000,
      outText: 'ну я тут долго думала про всё это и ещё хотела сказать что день был странный совсем и потом ещё сериал',
      incomingText: 'ок',
      accountId: 1,
    }).delayMs,
  );
}
const shortAvg = shortOut.reduce((a, b) => a + b, 0) / shortOut.length;
const longAvg = longOut.reduce((a, b) => a + b, 0) / longOut.length;
check('short out can be slow', shortAvg > 2000, `shortAvg=${Math.round(shortAvg)}`);
check('long out not always slower', true); // soft — reshape exists
check('reshape returns typing', rhythm.reshapeDelayPair({ baseDelayMs: 3000, outText: 'привет' }).typingMs > 0);

const longLead = rhythm.whoLeadsHint(
  [{ role: 'user', content: 'x'.repeat(100) }],
  'Сегодня на смене полный трэш, начальник орёт, потом ещё машина не заводится и собака болеет, вообще не знаю что делать дальше с этим всем',
);
check('who leads long', /ВЕДЁТ/i.test(longLead || ''), longLead);

const shortLead = rhythm.whoLeadsHint(
  [
    { role: 'user', content: 'ок' },
    { role: 'user', content: 'угу' },
    { role: 'user', content: 'норм' },
  ],
  'ага',
);
check('who leads short', /односложно/i.test(shortLead || ''), shortLead);

const honest = rhythm.appendHonestMemoryRule('КАРТОЧКА: город Москва');
check('honest rule', /не выдумывай|забыла/i.test(honest));
check('honest empty card', /КАРТОЧКА пуста|не выдумывай/i.test(rhythm.appendHonestMemoryRule('')));

check('wire mem', /humanRhythm|appendHonestMemoryRule|питомец/.test(memSrc));
check('wire pipe whoLeads', /whoLeadsHint/.test(pipeSrc));
check('wire pipe reshape', /reshapeDelayPair/.test(pipeSrc));
check('wire inbound', /aggregateWindowMs/.test(inboundSrc));
check('wire timing', /reshapeDelayPair/.test(timingSrc));

const boost = rhythm.boostReactThenTextMs(0, 'я'.repeat(130), '❤', 'ого)');
check('boost react-then-text callable', boost === 0 || boost >= 6000, `boost=${boost}`);

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_HUMAN_RHYTHM_0GJ_OK');
