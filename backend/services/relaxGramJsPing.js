const fs = require('fs');

// GramJS пингует Telegram каждые 9 секунд и обрывает пинг через 10.
// Через прокси ответ часто дольше 10 секунд: библиотека пишет Error: TIMEOUT
// и вызывает reconnect(), из-за этого pm2 error-лог забивается и сессия дёргается.
// Константы зашиты в node_modules, поэтому правим файл до первого require('telegram').
const REPLACEMENTS = [
  ['PING_TIMEOUT', 25000],
  ['PING_WAKE_UP_TIMEOUT', 15000],
  ['PING_FAIL_INTERVAL', 1500],
];

function replacePingConst(source, name, value) {
  const pattern = new RegExp(`((?:const|let|var)\\s+${name}\\s*=\\s*)\\d+`);
  if (!pattern.test(source)) return { source, changed: false };
  return { source: source.replace(pattern, `$1${value}`), changed: true };
}

function relaxGramJsPingTimeout() {
  let updatesPath;
  try {
    updatesPath = require.resolve('telegram/client/updates.js');
  } catch (_) {
    console.error('[telegram] Пакет telegram не найден — таймаут пинга не изменён.');
    return;
  }

  let source;
  try {
    source = fs.readFileSync(updatesPath, 'utf8');
  } catch (err) {
    console.error('[telegram] Не удалось прочитать updates.js:', err.message);
    return;
  }

  if (/PING_TIMEOUT\s*=\s*25000/.test(source)) return;

  let next = source;
  const applied = [];
  for (const [name, value] of REPLACEMENTS) {
    const result = replacePingConst(next, name, value);
    next = result.source;
    if (result.changed) applied.push(name);
  }

  if (!applied.includes('PING_TIMEOUT')) {
    console.error('[telegram] В установленной версии GramJS не найден PING_TIMEOUT — сессия может по-прежнему рваться.');
    return;
  }

  try {
    fs.writeFileSync(updatesPath, next);
    console.log(`[telegram] Пинг GramJS увеличен (${applied.join(', ')}), чтобы TIMEOUT через прокси не рвал сессию.`);
  } catch (err) {
    console.error('[telegram] Не удалось поправить таймаут пинга GramJS:', err.message);
  }
}

relaxGramJsPingTimeout();

// Даже если правка файла не применилась (другая версия пакета), не сыпем
// этот ожидаемый TIMEOUT в pm2 error-лог. Остальные ошибки не трогаем.
const originalConsoleError = console.error;
console.error = function patchedConsoleError(...args) {
  const err = args[0];
  const stack = err && typeof err.stack === 'string' ? err.stack : '';
  if (err && err.message === 'TIMEOUT' && stack.includes('updates.js')) {
    return;
  }
  return originalConsoleError.apply(console, args);
};

module.exports = { relaxGramJsPingTimeout };
