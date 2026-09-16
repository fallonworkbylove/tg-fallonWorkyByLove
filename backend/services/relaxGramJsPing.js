const fs = require('fs');

// GramJS пингует Telegram каждые 9 секунд и обрывает пинг через 10.
// Через прокси ответ часто дольше 10 секунд: библиотека пишет Error: TIMEOUT
// и вызывает reconnect(), из-за этого pm2 error-лог забивается и сессия дёргается.
// Константы зашиты в node_modules, поэтому правим файл до первого require('telegram').
const REPLACEMENTS = [
  ['const PING_TIMEOUT = 10000;', 'const PING_TIMEOUT = 25000;'],
  ['const PING_WAKE_UP_TIMEOUT = 3000;', 'const PING_WAKE_UP_TIMEOUT = 15000;'],
  ['const PING_FAIL_INTERVAL = 100;', 'const PING_FAIL_INTERVAL = 1500;'],
];

function relaxGramJsPingTimeout() {
  let updatesPath;
  try {
    updatesPath = require.resolve('telegram/client/updates.js');
  } catch (_) {
    return;
  }

  let source;
  try {
    source = fs.readFileSync(updatesPath, 'utf8');
  } catch (_) {
    return;
  }

  if (source.includes('const PING_TIMEOUT = 25000;')) return;

  let next = source;
  for (const [from, to] of REPLACEMENTS) {
    if (!next.includes(from)) return;
    next = next.replace(from, to);
  }

  try {
    fs.writeFileSync(updatesPath, next);
    console.log('[telegram] Пинг GramJS увеличен до 25с, чтобы TIMEOUT через прокси не рвал сессию.');
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
