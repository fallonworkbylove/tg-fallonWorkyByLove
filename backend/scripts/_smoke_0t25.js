'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
const fs = require('fs');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const life = fs.readFileSync(path.join(__dirname, '../services/lifeTexture.js'), 'utf8');
assert(/0t25: чуть чаще характер/.test(life) || /rand\(\) < 0\.68/.test(life), 'disagree bump');
assert(/rand\(\) < 0\.18/.test(life), 'character bump');
const ma = fs.readFileSync(path.join(__dirname, '../services/messageAnalysis.js'), 'utf8');
assert(!/ну ты милый\)»/.test(ma), 'no milyi hint');
assert(/тепло от тебя\)»/.test(ma), 'warm hint');
console.log('SMOKE_0t25_OK');
