const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'services', 'telegramClient.js');
let s = fs.readFileSync(p, 'utf8');

const peersEnd = "} = require('./peers');\n";
if (!s.includes("require('./scanCatchup')")) {
  if (!s.includes(peersEnd)) throw new Error('peers require end missing');
  s = s.replace(
    peersEnd,
    `} = require('./peers');
const {
  configureScanCatchup,
  scanUnansweredDialogs,
  startPeriodicScan,
  stopPeriodicScan,
  SCAN_INTERVAL_MS,
} = require('./scanCatchup');
`,
  );
}

// Remove scan block (scanInFlight through end of scanUnansweredDialogs)
const scanStart = s.indexOf('// Защита от параллельных сканов одного и того же аккаунта.');
if (scanStart < 0) {
  // alt
}
const altStart = s.indexOf('const scanInFlight = new Set();');
const greetStart = s.indexOf(
  '// ---------------------------------------------------------------------------\n// ПОЖЕЛАНИЯ «СПОКОЙНОЙ НОЧИ»',
);
if (altStart < 0 || greetStart < 0) throw new Error(`scan cut ${altStart} ${greetStart}`);
// Include comment before scanInFlight if present
let cutFrom = altStart;
const commentBefore = s.lastIndexOf('// Защита от параллельных сканов', altStart);
if (commentBefore > 0 && altStart - commentBefore < 200) cutFrom = commentBefore;
s = s.slice(0, cutFrom) + s.slice(greetStart);

// Update onClientActivated to use startPeriodicScan
s = s.replace(
  /if \(!scanTimers\.has\(accountId\)\) \{\n    const timer = setInterval\(\(\) => \{\n      scanUnansweredDialogs\(accountId, 90\)\.catch\(\(\) => \{\}\);\n    \}, SCAN_INTERVAL_MS\);\n    if \(typeof timer\.unref === 'function'\) timer\.unref\(\);\n    scanTimers\.set\(accountId, timer\);\n  \}/,
  'startPeriodicScan(accountId);',
);

// Update clearAccountRuntime scan timer cleanup
s = s.replace(
  /const timer = scanTimers\.get\(accountId\);\n  if \(timer\) \{\n    clearInterval\(timer\);\n    scanTimers\.delete\(accountId\);\n  \}\n\n  const bTimer/,
  'stopPeriodicScan(accountId);\n\n  const bTimer',
);

// Remove scanInFlight.delete from clearAccountRuntime if stopPeriodicScan handles it
s = s.replace(/\n  scanInFlight\.delete\(accountId\);/, '');

// Configure scan after configurePeers
if (!s.includes('configureScanCatchup({')) {
  const peersCfg = s.indexOf('configurePeers({');
  if (peersCfg < 0) throw new Error('configurePeers missing');
  // find matching close of configurePeers - look for onPeerRetired block end
  const afterPeers = s.indexOf('});\n', s.indexOf('onPeerRetired', peersCfg));
  if (afterPeers < 0) throw new Error('configurePeers end');
  const insertAt = afterPeers + 3;
  s =
    s.slice(0, insertAt) +
    `

configureScanCatchup({
  getAccountSettings: (id) => getAccountSettings(id),
  bufferKey: (a, p) => bufferKey(a, p),
  getMessageBuffers: () => messageBuffers,
  getDeferredDialogs: () => deferredDialogs,
  getProcessingInFlight: () => processingInFlight,
  extractIncomingText: (...args) => extractIncomingText(...args),
  processBufferedMessages: (...args) => processBufferedMessages(...args),
});
` +
    s.slice(insertAt);
}

fs.writeFileSync(p, s);
console.log('ok lines', s.split(/\n/).length);
