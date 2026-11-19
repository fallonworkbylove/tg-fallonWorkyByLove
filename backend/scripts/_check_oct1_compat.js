const fs = require('fs');
const { execSync } = require('child_process');

const tc = fs.readFileSync('services/telegramClient.js', 'utf8');
const destructure = tc.match(/const\s*\{([^}]+)\}\s*=\s*require\(['"]\.\/aiResponder['"]\)/);
const names = destructure
  ? destructure[1]
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+|\s*=\s*/)[0].trim())
      .filter(Boolean)
  : [];

const oct1 = execSync('git show 7c97b46:backend/services/aiResponder.js', {
  cwd: '/root/opt/tgbot/tg-miniapp-loverussian',
  maxBuffer: 5e6,
}).toString();

// Write temp and require — risky if side effects. Instead parse exports.
const exportBlock = oct1.match(/Object\.assign\(module\.exports,\s*\{([\s\S]*?)\}\);?\s*$/m)
  || oct1.match(/module\.exports\s*=\s*\{([\s\S]*?)\};?\s*$/m);
const exported = new Set();
if (exportBlock) {
  for (const m of exportBlock[1].matchAll(/^\s*([A-Za-z0-9_]+)\s*,?\s*$/gm)) {
    exported.add(m[1]);
  }
  for (const m of exportBlock[1].matchAll(/^\s*([A-Za-z0-9_]+)\s*:/gm)) {
    exported.add(m[1]);
  }
}
// also module.exports.foo =
for (const m of oct1.matchAll(/module\.exports\.([A-Za-z0-9_]+)\s*=/g)) {
  exported.add(m[1]);
}

console.log('telegramClient needs', names.length, 'named imports:');
const missing = [];
for (const n of names) {
  const ok = exported.has(n) || oct1.includes(`function ${n}`) || oct1.includes(`async function ${n}`) || oct1.includes(`const ${n}`) || oct1.includes(`module.exports.${n}`);
  if (!ok) missing.push(n);
  console.log((ok ? '  OK ' : 'MISS'), n);
}
console.log('MISSING', missing.length, missing.join(', ') || '(none)');
console.log('oct1 bytes', oct1.length);
