process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const assert = require('assert');
const soft = require('../services/softHumanLite');
const {
  pickMediaByContext,
  claimsIndoorSetting,
  looksOutdoorDesc,
  isSafeForIndoorClaim,
} = require('../services/mediaReplies');

assert.ok(!/cepiously|serious/i.test(soft.scrubRuLatinGarbage('cepiously?)) ну ты')));
assert.ok(/серьёзн/i.test(soft.scrubRuLatinGarbage('cepiously?)) ну ты')));
assert.ok(/серьёзн/i.test(soft.scrubRuLatinGarbage('seriously?)) ну ты')));
assert.equal(soft.scrubRuLatinGarbage('lol u serious?'), 'серьёзно?');
assert.ok(claimsIndoorSetting('просто в пижаме валяюсь'));
assert.ok(claimsIndoorSetting('сейчас дома просто валяюсь'));
assert.ok(looksOutdoorDesc('девушка в меховой шапке на фоне снежных гор и машины'));
assert.ok(!isSafeForIndoorClaim('девушка в меховой шапке на фоне снежных гор'));

const items = [
  { id: 1, type: 'photo' },
  { id: 2, type: 'photo' },
];
const descriptions = {
  1: 'селфи дома на диване в пижаме',
  2: 'на улице зимой у гор в меховой шапке',
};
const picked = pickMediaByContext(items, 'photo', new Set(), descriptions, 'просто в пижаме валяюсь', {
  requireMatch: true,
});
assert.ok(picked && picked.id === 1, 'indoor claim → indoor photo, got ' + (picked && picked.id));

const none = pickMediaByContext(
  [{ id: 2, type: 'photo' }],
  'photo',
  new Set(),
  { 2: descriptions[2] },
  'просто в пижаме валяюсь',
  { requireMatch: true },
);
assert.equal(none, null, 'only outdoor → null when pajamas');

console.log('smoke_chat_audit5 OK');
