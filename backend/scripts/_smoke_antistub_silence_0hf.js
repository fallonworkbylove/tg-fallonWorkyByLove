/**
 * Smoke 0hf: anti-stub on question + no silent-react on «как и вчера» + no life-lag on media.
 */
const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('OK', msg);
  }
};

const hh = require('../services/humanHardening');
const ops = require('../services/opsQuality');
const i10 = require('../services/humanIdeas10');

// --- anti-stub ---
{
  const out = hh.expandBareStubOnQuestion('ок)', 'Чего в Липецке жила?');
  assert(out !== 'ок)', 'stub lipetsk not bare ok');
  assert(out.length > 8, 'stub lipetsk has substance: ' + out);
  assert(!/^ок\)?$/i.test(out), 'stub lipetsk not just ok');
}
{
  const out = hh.expandBareStubOnQuestion('поняла)', 'Можешь видео записать лайф');
  assert(/позже|неудоб|занята|не могу/i.test(out), 'stub media → defer text: ' + out);
}
{
  const keep = hh.expandBareStubOnQuestion('ок)', 'ага');
  assert(keep === 'ок)', 'bare ok stays on bare ack user');
}
{
  const through = hh.applyHardeningPostfilters('ну да)', [], 'Чего в Липецке жила?', 1, 2);
  assert(!/^ну да\)?$/i.test(String(through).trim()), 'hardening expands stub on Q: ' + through);
}

// --- preferSilentReaction ---
{
  let hit = 0;
  for (let i = 0; i < 40; i++) {
    if (ops.preferSilentReaction('Как и вчера', { leadTier: 'cold' })) hit += 1;
  }
  assert(hit === 0, 'как и вчера never silent-react (hit=' + hit + ')');
}
{
  let hit = 0;
  for (let i = 0; i < 40; i++) {
    if (ops.preferSilentReaction('ок)', { leadTier: 'cold', forceBareOk: true })) hit += 1;
  }
  assert(hit === 40, 'forceBareOk still works on ок)');
}

// --- life lag ---
{
  const realRandom = Math.random;
  Math.random = () => 0; // force lag chance if allowed
  assert(i10.maybeLifeLagMs('Можешь видео записать лайф') === 0, 'no life-lag on video life');
  assert(i10.maybeLifeLagMs('Запиши кружок пожалуйста') === 0, 'no life-lag on circle ask');
  assert(i10.maybeLifeLagMs('Чего в Липецке жила?') === 0, 'no life-lag on ?');
  assert(i10.maybeLifeLagMs('Как и вчера') === 0, 'no life-lag on как и вчера');
  const lag = i10.maybeLifeLagMs('вчера с друзьями ходили в кино смотрели фильм', {
    leadTier: 'cold',
  });
  assert(lag === 0 || (lag >= 25000 && lag <= 55000), 'life-lag capped 25–55s: ' + lag);
  Math.random = realRandom;
}

console.log(process.exitCode ? 'SMOKE_FAIL' : 'SMOKE_OK');
process.exit(process.exitCode || 0);
