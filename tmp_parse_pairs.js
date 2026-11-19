const fs = require('fs');
let s = fs.readFileSync('tmp_round_pairs.json', 'utf8');
const idx = s.indexOf('{"bad"');
const idx2 = s.indexOf('{ "bad"');
const start = idx >= 0 ? idx : idx2 >= 0 ? idx2 : s.indexOf('"bad"');
if (start < 0) {
  console.error('no json', s.slice(0, 300));
  process.exit(1);
}
// rewind to {
const brace = s.lastIndexOf('{', start);
s = s.slice(brace >= 0 ? brace : start);
fs.writeFileSync('tmp_round_pairs.json', s, 'utf8');
const j = JSON.parse(s);
console.log('bad', j.bad.length, 'fresh', j.fresh.length);
j.bad.forEach((x, i) => {
  console.log(i + 1, '[' + x.hits.join(',') + ']', x.peer);
  console.log('  ОН:', x.u.slice(0, 90));
  console.log('  ОНА:', x.a.slice(0, 100));
});
