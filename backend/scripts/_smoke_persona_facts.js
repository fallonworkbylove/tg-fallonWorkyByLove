/**
 * personaFacts: город / как давно / распаковка — из промпта, без выдумок.
 */
const pf = require('../services/personaFacts');
const oh = require('../services/objectionHandler');
const soft = require('../services/softHumanLite');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('ok:', msg);
}

const prompt =
  'Ты девушка, тебя зовут Галина. Живёшь в Москве, переезжаешь в Анапу к маме. ' +
  'Уже пару лет тут. Работаешь онлайн.';

{
  const card = pf.parsePersonaCard(prompt);
  assert(card.fromCity === 'Москве' || card.fromCity === 'Москва' || /Моск/i.test(card.fromCity), `from=${card.fromCity}`);
  assert(/Анап/i.test(card.toCity), `to=${card.toCity}`);
  assert(card.packing, 'packing');
}

{
  assert(pf.isSelfFactQuestion('из какого ты города?'), 'q city');
  assert(pf.isSelfFactQuestion('а как давно в Москве?'), 'q how long');
  assert(pf.isSelfFactQuestion('Ну ты тут уже ?'), 'q already here');
  assert(!pf.isSelfFactQuestion('а почему переезжаешь?'), 'why move not fact-q');
}

{
  const hint = pf.buildFactHint(prompt, 'из какого ты города?', []);
  assert(/Моск/i.test(hint) && /Анап/i.test(hint), `hint cities → ${hint.slice(0, 80)}`);
  assert(/не выдумывай|ФАКТЫ/i.test(hint), 'hint hard card');
}

{
  const hint = pf.buildFactHint(prompt, 'а как давно в Анапе?', []);
  assert(/ещё не|собира/i.test(hint), `dest how-long → ${hint.slice(0, 120)}`);
}

{
  const out = pf.groundReply(
    'я в Анапе уже живу)',
    'Ну ты тут уже ?',
    [{ role: 'assistant', content: 'ещё в Москве, собираюсь в Анапу' }],
    prompt,
  );
  assert(!/уже живу|я в Анапе уже/i.test(out) || /Моск|собира|ещё/i.test(out), `arrived claim → ${out}`);
}

{
  const out = pf.groundReply(
    'ну 7 лет уже)',
    'а как давно в Москве?',
    [],
    prompt,
  );
  assert(!/7\s*лет/i.test(out), `invented years → ${out}`);
}

{
  const out = pf.groundReply(
    'коробки распаковываю',
    'чем занята?',
    [{ role: 'assistant', content: 'ещё в Москве собираюсь' }],
    prompt,
  );
  assert(!/распаков/i.test(out), `unpack → ${out}`);
}

{
  const hint = oh.detectHint('из какого ты города?', [], { systemPrompt: prompt });
  assert(hint && /Моск|ФАКТЫ|гео|город/i.test(hint), `oh hint → ${(hint || '').slice(0, 100)}`);
}

{
  const out = soft.stripFalseSeasonCorrection(
    'хах какая весна, осень же)',
    'уже утро, солнце',
  );
  assert(!/весн/i.test(out), `false season → ${out}`);
}

console.log('all persona_facts smokes passed');
