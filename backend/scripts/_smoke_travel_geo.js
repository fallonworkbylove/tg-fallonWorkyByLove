#!/usr/bin/env node
/**
 * Дальняя дорога: не «поезд Москва→Анапа за 4 часа».
 */
const pf = require('../services/personaFacts');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else console.log('ok', msg);
}

const prompt = 'Ты живёшь в Москве, переезжаешь в Анапу к маме. Витязево рядом.';
const card = pf.parsePersonaCard(prompt);
assert(card.fromCity && /москв/i.test(card.fromCity), 'from Moscow: ' + card.fromCity);
assert(card.toCity && /анап/i.test(card.toCity), 'to Anapa: ' + card.toCity);
assert(card.packing, 'packing');

const band = pf.trainHourBand(card.fromCity, card.toCity);
assert(band && band[0] >= 16, 'train band long: ' + JSON.stringify(band));

assert(pf.extractClaimedTravelHours('часа четыре, не очень долго') === 4, 'hours word');
assert(pf.extractClaimedTravelHours('где-то 20-24 часа') >= 20, 'hours range');

const bad = pf.groundReply(
  'часа четыре, не очень долго',
  'на чем доберешься?',
  [{ role: 'assistant', content: 'поеду на поезде' }],
  prompt,
);
assert(
  !/часа\s+четыре|4\s*час/i.test(bad) || /самол|сутки|долго|20|час/i.test(bad),
  'no 4h train lie: ' + bad,
);
assert(/самол|долго|сутки|поезд/i.test(bad), 'mentions realistic: ' + bad);

const okPlane = pf.groundReply('самолётом часа два)', 'как доберешься?', [], prompt);
assert(/самол|два/i.test(okPlane), 'plane short ok: ' + okPlane);

const hint = pf.buildTravelDurationHint(card);
assert(/ДОРОГА|поезд|самол/i.test(String(hint || '')), 'travel hint');

const fact = pf.buildFactHint(prompt, 'на чем доберешься до Анапы?');
assert(/ДОРОГА|ЗАПРЕЩЕНО/i.test(String(fact || '')), 'fact hint travel: ' + String(fact || '').slice(0, 120));

const vit = pf.trainHourBand('Москва', 'Витязево');
assert(vit && vit[0] >= 16, 'Vityazevo ~ Anapa band: ' + JSON.stringify(vit));

const mashaPrompt =
  'Ты — Маша, 24 года. Обычная живая девушка.\n' +
  'Ты из России, долго жила в Москве. Сейчас переезжаешь в Анапу: нашла жильё.\n' +
  'Сейчас: Москва → переезд в Анапа\n' +
  'откуда едешь = Москва, куда = Анапа';
const masha = pf.parsePersonaCard(mashaPrompt);
assert(masha.fromCity && /москв/i.test(masha.fromCity), 'masha from: ' + masha.fromCity);
assert(masha.toCity && /анап/i.test(masha.toCity), 'masha to: ' + masha.toCity);
assert(masha.packing, 'masha packing');

const planted = pf.groundReply(
  'да, точно, завтра уже в пути',
  'Поезд завтра, ты де помнишь?)',
  [],
  mashaPrompt,
);
assert(!/завтра\s+уже\s+в\s+пути/i.test(planted), 'no affirm planted tomorrow: ' + planted);

const inventTime = pf.groundReply(
  'поезд вечером, около 9, если не ошибаюсь',
  'Во сколько поезд?)',
  [],
  mashaPrompt,
);
assert(!/около\s+9|вечером,\s*около/i.test(inventTime), 'no invented train time: ' + inventTime);

console.log('TRAVEL_GEO', process.exitCode ? 'FAIL' : 'OK');
process.exit(process.exitCode || 0);
