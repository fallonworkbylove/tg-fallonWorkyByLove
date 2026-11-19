const fs = require('fs');
const p = require('path').join(__dirname, '../services/helpRequestNotifier.js');
let s = fs.readFileSync(p, 'utf8');
const before = (s.match(/await fetch\(`\$\{TELEGRAM_API\}/g) || []).length;
s = s.replace(/await fetch\(`\$\{TELEGRAM_API\}/g, 'await botFetch(`${TELEGRAM_API}');
fs.writeFileSync(p, s);
const after = (s.match(/await botFetch\(`\$\{TELEGRAM_API\}/g) || []).length;
console.log({ before, after });
