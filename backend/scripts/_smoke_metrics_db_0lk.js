#!/usr/bin/env node
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-smoke-0lk';
const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
  console.log('OK', msg);
}

const src = fs.readFileSync(path.join(__dirname, '../services/opsLiveMetrics.js'), 'utf8');
assert(/INTERVAL 1 HOUR|INTERVAL 60 MINUTE/.test(src), 'replies last hour from DB');
assert(/is_autoreply_enabled/.test(src), 'stale uses AI-on accounts');
assert(/staleAiAccounts/.test(src) && /silentMin/.test(src), 'staleAiAccounts shape');
assert(/repliesPerHourDb|repliesLastHour|repliesPerHour/.test(src), 'repliesPerHour wired');
assert(!/uptimeMin > 0 \? Math\.round\(\(counters\.replies/.test(src), 'no uptime-extrapolate for RPH');

const live = require('../services/opsLiveMetrics');
assert(typeof live.getLiveMetrics === 'function', 'getLiveMetrics export');

console.log('SMOKE_0lk_OK');
process.exit(0);
