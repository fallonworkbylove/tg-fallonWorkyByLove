'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
const fs = require('fs');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const g = require(path.join(__dirname, '../services/softHumanGates'));
const liteSrc = fs.readFileSync(path.join(__dirname, '../services/softHumanLite.js'), 'utf8');
assert(!/['"]ну ладно(?:\s+тогда)?\)['"]/.test(liteSrc), 'no nu ladno alts');

const hist = [{ role: 'assistant', content: 'слушай, я тут)' }];
const sl = g.fixOpenerLoop('слушай, как дела)', hist);
assert(sl && !/^слушай\b/i.test(sl), 'slushay opener');

const daily = fs.readFileSync(path.join(__dirname, '../services/dailyLife.js'), 'utf8');
assert(/чай заварила/.test(daily), 'idle variety');
console.log('SMOKE_0t22_OK');
