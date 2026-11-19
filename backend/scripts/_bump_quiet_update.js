const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const p = path.join(root, 'frontend', 'updates.js');
let u = fs.readFileSync(p, 'utf8');
if (!/Тихие часы только ночью/.test(u)) {
  const entry = `  {
    date: '30 октября',
    tag: 'МАЛЕНЬКОЕ',
    title: 'Тихие часы только ночью',
    lead: 'Исправлена ошибка: «тихие часы» ошибочно включались днём. Теперь голосовые пинги молчат только ночью, с часу до восьми по Москве.',
    items: [
      'Обычные текстовые ответы этим не блокировались — чинили ложный ночной режим для голосовых.',
    ],
  },
`;
  u = u.replace(
    /(window\.LOVERUSSIAN_UPDATES = \[\r?\n  \/\* ——— октябрь 2026 ——— \*\/\r?\n)/,
    `$1${entry}`,
  );
  fs.writeFileSync(p, u, 'utf8');
}
const indexPath = path.join(root, 'frontend', 'index.html');
let i = fs.readFileSync(indexPath, 'utf8');
i = i.replace(/updates\.js\?v=\d+/, 'updates.js?v=100');
fs.writeFileSync(indexPath, i, 'utf8');
fs.copyFileSync(p, path.join(root, 'ops-console', 'app', 'updates.js'));
console.log('BUMP_OK');
