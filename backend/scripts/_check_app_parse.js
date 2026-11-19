const fs = require('fs');
const p = process.argv[2] || 'frontend/app.js';
const s = fs.readFileSync(p, 'utf8');
console.log('bytes', Buffer.byteLength(s), 'chars', s.length);
try {
  new Function(s);
  console.log('PARSE_OK');
} catch (e) {
  console.log('PARSE_FAIL', e.message);
  process.exit(1);
}
