'use strict';
process.env.AUDIT_SMOKE = '1';
const path = require('path');
const fs = require('fs');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const live = fs.readFileSync(path.join(__dirname, '../services/opsLiveMetrics.js'), 'utf8');
assert(/queryStaleAiAccounts/.test(live), 'stale helper');
assert(/LIVE_METRICS_TTL_MS/.test(live), 'ttl cache');
assert(/INTERVAL 1 DAY/.test(live), 'bounded assistant window');
assert(!/LEFT JOIN conversation_messages cm\s*\n\s*ON cm\.account_id = a\.id AND cm\.role = 'assistant'\s*\n\s*AND cm\.content NOT LIKE/.test(live), 'no old join');
const stats = fs.readFileSync(path.join(__dirname, '../services/adminConsoleStats.js'), 'utf8');
assert(/withTimeout/.test(stats), 'timeout wrapper');
assert(/limit: 120/.test(stats), 'smaller funnel');
const app = fs.readFileSync(path.join(__dirname, '../../frontend/app.js'), 'utf8');
assert(/Не удалось загрузить — нажми/.test(app), 'frontend finally');
console.log('SMOKE_0t37_OK');
