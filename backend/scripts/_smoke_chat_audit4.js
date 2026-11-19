/**
 * Smoke: гео «где живёшь», подпись не «это я» на еду, встреча без коробок,
 * грамматика «занимаешь».
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-smoke-audit4-not-real';

const assert = require('assert');
const oh = require('../services/objectionHandler');
const soft = require('../services/softHumanLite');
const { pickCaption } = require('../services/mediaReplies');

assert.ok(oh.isLocationAsk('А где ты живёшь'), 'geo: где ты живёшь');
assert.ok(oh.isLocationAsk('А где ты живешь?'), 'geo: живешь');
assert.ok(oh.isLocationAsk('А где?'), 'geo: а где?');
assert.ok(oh.isLocationAsk('Живёшь'), 'geo: Живёшь');
assert.ok(oh.isLocationAsk('ты где'), 'geo: ты где');
assert.ok(!oh.isLocationAsk('где ты брала это'), 'geo: не цеплять где брала');

const geoHint = oh.detectHint('А где ты живёшь', [], {
  systemPrompt: 'Ты — Вика. Живёшь в Белгороде.',
});
assert.ok(geoHint && /ГДЕ|город|МЕСТО|промпт|месте/i.test(geoHint), 'geo hint: ' + geoHint);

const meetHint = oh.detectHint(
  'В субботу может приеду в тимашевск ) если хочешь могли б встретиться )',
  [],
  {},
);
assert.ok(meetHint && /встрет/i.test(meetHint), 'meet hint present');
assert.ok(
  !/пока коробки|со сборами|через пару недель уже буду/i.test(meetHint),
  'meet hint не толкает в коробки: ' + meetHint,
);
assert.ok(/ЗАПРЕЩЕНО уходить в переезд/i.test(meetHint), 'meet bans move deflect');
assert.ok(/про если/i.test(meetHint), 'meet hint bans про если');

const foodCap = pickCaption('photo', 'ru', { description: 'еда: суши и зелень на тарелке' });
assert.ok(!/это\s+я|ну\s+вот\s+я/i.test(foodCap || ''), 'food caption not это я: ' + foodCap);

assert.strictEqual(
  soft.fixRuAgreementGlitches('а чем занимаете?'),
  'а чем занимаешься?',
);
assert.ok(!/про если/i.test(soft.fixRuAgreementGlitches('а, про если)')));

const enriched = soft.enrichBareAckOnSubstance('ага)', 'Если хочешь могли б встретиться в субботу');
assert.ok(!/про если/i.test(enriched), 'enrich no про если: ' + enriched);

console.log('smoke_chat_audit4 OK');
