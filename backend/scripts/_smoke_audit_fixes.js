/**
 * Smoke: топики медиа, sanitize исходящего, robotic strip, prompt wiring.
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';

const mr = require('../services/mediaReplies');
const soft = require('../services/softHumanLite');
const thin = require('../services/humanThinLayer');
const pf = require('../services/personaFacts');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('ok:', msg);
}

{
  const p = mr.parseMediaLink('https://t.me/c/3983818988/2');
  assert(p.peer === '-1003983818988', `peer=${p.peer}`);
  assert(p.topicId === 2, `topic=${p.topicId}`);
}

{
  const p = mr.parseMediaLink('https://t.me/+qcNqkNZJYqI0YmQy');
  assert(p.kind === 'invite' && p.hash, `invite=${p.hash}`);
}

{
  const out = soft.stripRoboticGirl('Конечно! Чем могу помочь с вашим вопросом');
  assert(!/чем могу помочь|конечно/i.test(out), `robotic → ${out}`);
}

{
  const out = thin.applyThinPostfilters('в смысле?', 'из какого ты города?', [], 'Живёшь в Москве, переезжаешь в Анапу.');
  assert(out && !/ReferenceError/i.test(String(out)), `thin ok → ${out}`);
}

{
  const card = pf.parsePersonaCard('Живёшь в Москве, переезжаешь в Анапу. Уже пару лет тут.');
  assert(/Моск/i.test(card.fromCity) && /Анап/i.test(card.toCity), 'persona card');
  const g = pf.groundReply('коробки распаковываю', 'чем занята?', [], 'Живёшь в Москве, переезжаешь в Анапу.');
  assert(!/распаков/i.test(g), `ground unpack → ${g}`);
}

{
  const tc = require('../services/telegramClient');
  const leaked = tc.stripLeakedMediaHistoryTag(
    '[медиа:#12] {кружок: селфи дома в худи} ну а у тебя как?',
  );
  assert(
    leaked.leakedType === 'circle' && !/селфи|медиа:#/i.test(leaked.text) && /у тебя/i.test(leaked.text),
    `leak strip → ${JSON.stringify(leaked)}`,
  );
}

console.log('all audit_fixes smokes passed');
