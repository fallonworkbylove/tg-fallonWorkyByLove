'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const g = require(path.join(__dirname, '../services/softHumanGates'));
const love = g.fixLoveStampOveruse('ну ты милый)', [
  { role: 'assistant', content: 'мне приятно)' },
]);
assert(love && !/^ну ты милый/i.test(love), 'love stamp');
const int = g.fixInterestingAlone('интересно)', 'сегодня ездил в другой город весь день');
assert(int && !/^интересно\s*\)?$/i.test(int), 'interesting');
const ok = g.fixOKakStamp('о как)', [{ role: 'assistant', content: 'о как)' }]);
assert(ok && !/^о как\s*\)?$/i.test(ok), 'o kak');
console.log('SMOKE_0t15_OK');
