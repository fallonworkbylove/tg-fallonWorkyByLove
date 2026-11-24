'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
const fs = require('fs');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const g = require(path.join(__dirname, '../services/softHumanGates'));
const dead = g.fixDeadFillerReply('ну ясно)', 'сегодня весь день ездил по городу и устал');
assert(dead && !/^ну\s+ясно\s*\)?$/i.test(dead), 'nu yasno dead');
const ideas = fs.readFileSync(path.join(__dirname, '../services/humanIdeas13.js'), 'utf8');
assert(!/ну ясно\)/.test(ideas), 'ideas no nu yasno');
console.log('SMOKE_0t31_OK');
