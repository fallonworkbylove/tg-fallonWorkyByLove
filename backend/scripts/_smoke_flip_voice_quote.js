#!/usr/bin/env node
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';
const { findVoiceForText } = require('../services/voiceReplies');
const objection = require('../services/objectionHandler');

let fail = 0;
function check(name, ok, detail) {
  console.log(ok ? 'OK' : 'FAIL', name, detail || '');
  if (!ok) fail += 1;
}

const quotedPitch =
  '[ответ на «я занимаюсь флипингом цифровых токенов, это нормально так»]: Ты второй девушка уже 😂';
const hit = findVoiceForText(quotedPitch);
check('no flip voice on quote+вторая девушка', hit == null);
if (hit) console.log('  got', hit.fileName, hit.voiceOnly);

const ask =
  'а что такое флипинг? как ты этим зарабатываешь';
const askHit = findVoiceForText(ask);
check('still fires on real ask', askHit && askHit.fileName === 'flipping.ogg');

const bareSecond = 'Ты второй девушка уже';
check('no flip on bare вторая', findVoiceForText(bareSecond) == null);

const quoteOnly =
  '[ответ на «я занимаюсь флипингом цифровых токенов»]: ага понял';
check('no flip when keyword only in quote', findVoiceForText(quoteOnly) == null);

const callout = 'Про флипинг ты же в первый день еще говорила)';
check('no flip voice on repeat callout', findVoiceForText(callout) == null, findVoiceForText(callout));

const bareMention = 'ну да флипинг интересная тема';
check('no flip voice on bare mention', findVoiceForText(bareMention) == null);

const hint = objection.detectHint(callout, [
  { role: 'assistant', content: 'ещё флиппингом занимаюсь' },
]);
check(
  'hint is repeat not explain',
  !!hint && /повтор|УЖЕ говорила/i.test(hint) && !/не знает, что такое флип/i.test(hint),
  hint && hint.slice(0, 100),
);

if (fail) {
  console.error('FAILS', fail);
  process.exit(1);
}
console.log('SMOKE_FLIP_VOICE_QUOTE_OK');
