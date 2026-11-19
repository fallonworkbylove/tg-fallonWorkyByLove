/**
 * Скрин: «коробки распаковываю» → «ещё в Москве» → оправдание «заранее».
 */
const ar = require('../services/aiResponder');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('ok:', msg);
}

const hist = [
  { role: 'assistant', content: 'коробки распаковываю, вещи разлаживаю' },
  { role: 'user', content: 'Ты что приехала?' },
  { role: 'assistant', content: 'переезжаю в Анапу, да)' },
  { role: 'user', content: 'Ну ты тут уже ?' },
  { role: 'assistant', content: 'ещё в Москве, собираюсь в Анапу' },
];

{
  const out = ar.fixUnpackBeforeArrive(
    'коробки распаковываю, вещи разлаживаю',
    'Какими?',
    [],
  );
  assert(!/распаков|разлажив/i.test(out), `day-ask unpack → ${out}`);
  assert(/собира|короб|склад|сбор/i.test(out), `rewritten to packing → ${out}`);
}

{
  const out = ar.fixUnpackBeforeArrive(
    'потому что надо подготовиться заранее, всё равно придётся потом распаковывать) ты чего делаешь?)',
    'А зачем коробки распаковывать, если еще не приехала',
    hist,
  );
  assert(!/заранее|потом\s+придётся|распаков/i.test(out), `catch excuse → ${out}`);
  assert(/собира/i.test(out), `admit packing → ${out}`);
}

{
  const out = ar.fixUnpackBeforeArrive(
    'ещё в Москве, распаковываю коробки',
    'Ну ты тут уже ?',
    hist,
  );
  assert(!/распаков/i.test(out), `still Moscow + unpack → ${out}`);
}

console.log('all unpack/move smokes passed');
