#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const script = path.join(__dirname, '_hard_audit_0ht.js');
const r = spawnSync(process.execPath, [script], {
  env: { ...process.env, OPENAI_API_KEY: 'sk-audit' },
  encoding: 'utf8',
  timeout: 180_000,
  stdio: ['ignore', 'pipe', 'pipe'],
  maxBuffer: 4 * 1024 * 1024,
});
const out = `${r.stdout || ''}\n${r.stderr || ''}`;
console.log(
  JSON.stringify({
    status: r.status,
    signal: r.signal,
    error: r.error && r.error.message,
    outLen: out.length,
    hasOk: /HARD_AUDIT_0HT_OK/.test(out),
    hasFail: /HARD_AUDIT_0HT_FAIL|FAIL /.test(out),
    tail: out.slice(-120),
  }),
);
