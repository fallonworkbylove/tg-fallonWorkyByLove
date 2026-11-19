/**
 * Smoke 0hq: stub-after-reask, typo fixes, ensureAck ultra-short.
 */
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_PROXY_LIST = '';
const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('OK', msg);
  }
};

const hh = require('../services/humanHardening');
const soft = require('../services/softHumanLite');
const ai = require('../services/aiResponder');

{
  const hist = [
    { role: 'user', content: 'меня зовут Дима' },
    { role: 'assistant', content: 'приятно)' },
  ];
  const out = hh.applyHardeningPostfilters(
    'как тебя зовут?',
    hist,
    'ну расскажи ещё',
    1,
    2,
  );
  assert(!/^(?:ага|поняла)\)?$/i.test(String(out).trim()), 'reask not bare stub: ' + out);
  assert(String(out).trim().length >= 8, 'reask reply has body: ' + out);
}

{
  const out = hh.expandBareStubOnQuestion('ага)', 'Чего в Липецке жила?');
  assert(!/^ага\)?$/i.test(out), 'expand agа on Q: ' + out);
}

{
  const t = ai.fixModelTypos('нет, к маме переезжаю, ей нужна поддеожка');
  assert(/поддержка/i.test(t) && !/поддеож/i.test(t), 'typo поддеожка → поддержка: ' + t);
  const t2 = ai.fixModelTypos('о, звкчит вкусно)');
  assert(/звучит/i.test(t2) && !/звкчит/i.test(t2), 'typo звкчит → звучит: ' + t2);
}

{
  const out = soft.ensureAckNotBare('ага)');
  assert(!/^ага\)?$/i.test(out), 'ensureAck expands agа: ' + out);
  assert(out.length >= 6, 'ensureAck not ultra-short: ' + out);
}
{
  const out = soft.ensureAckNotBare('ну да)');
  assert(!/^ну\s+да\)?$/i.test(out), 'ensureAck expands ну да: ' + out);
}
{
  const out = soft.applySoftLite('ага)', [], 'я с района живу давно уже');
  assert(!/^ага\)?$/i.test(String(out).trim()), 'softLite not bare on substance: ' + out);
}

console.log(process.exitCode ? 'SMOKE_FAIL' : 'SMOKE_10OF10_0HQ_OK');
process.exit(process.exitCode || 0);
