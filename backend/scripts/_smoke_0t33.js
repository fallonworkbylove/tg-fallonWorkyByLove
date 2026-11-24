'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
const fs = require('fs');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const g = require(path.join(__dirname, '../services/softHumanGates'));
const r = g.fixAhahLadnoStamp('ахах ладно)', [{ role: 'assistant', content: 'ахах ладно)' }]);
assert(r && !/ладно/i.test(r), 'ahah ladno');
const wave = g.applyWave0t6Gates('ахах ладно)', [{ role: 'assistant', content: 'хах ладно)' }], 'ну');
assert(wave && !/ладно/i.test(wave), 'wave');
const lite = fs.readFileSync(path.join(__dirname, '../services/softHumanLite.js'), 'utf8');
assert(/разумеется[\s\S]{0,40}'ну да'/.test(lite), 'razumeetsya→ну да');
const life = fs.readFileSync(path.join(__dirname, '../services/lifeTexture.js'), 'utf8');
assert(/rand\(\) > 0\.6/.test(life), 'story 60');
console.log('SMOKE_0t33_OK');
