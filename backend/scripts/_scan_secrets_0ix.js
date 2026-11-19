#!/usr/bin/env node
'use strict';
/**
 * Static scan tracked-ish source for leaked key shapes (not git history deep).
 * Exit 0 even with findings — prints REPORT for operator; FAIL only on known probe leftovers.
 */
const fs = require('fs');
const path = require('path');

const roots = [
  path.join(__dirname, '..'),
  path.join(__dirname, '../../frontend'),
  path.join(__dirname, '../../ops-console'),
];
const skip =
  /node_modules|\.git|pnpm-lock|package-lock|media\/|\.session|\.env$|proxies-login\.txt|proxies\.txt|_scan_secrets_0ix|_smoke_security_0ix/i;
const patterns = [
  { name: 'openai_sk', re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: 'aws_key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'private_key', re: /BEGIN (RSA |OPENSSH )?PRIVATE KEY/g },
  { name: 'hardcoded_login_pass', re: /b4ea442eb8fb89cd/g },
];

const findings = [];
function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (skip.test(p)) continue;
    if (e.isDirectory()) walk(p);
    else if (/\.(js|ts|sh|md|html|json|txt|yml|yaml)$/i.test(e.name)) {
      let t;
      try {
        t = fs.readFileSync(p, 'utf8');
      } catch {
        continue;
      }
      if (t.length > 2_000_000) continue;
      for (const { name, re } of patterns) {
        re.lastIndex = 0;
        if (re.test(t)) {
          // smoke placeholders ok
          if (/sk-test|sk-smoke|sk-audit|local-smoke/i.test(t) && name === 'openai_sk') {
            const real = t.match(/\bsk-(?!test|smoke|audit)[A-Za-z0-9]{20,}\b/);
            if (!real) continue;
          }
          findings.push({ name, file: p.replace(/\\/g, '/') });
        }
      }
    }
  }
}

for (const r of roots) walk(r);
const hard = findings.filter((f) => f.name === 'hardcoded_login_pass');
console.log('SECRET_SCAN findings=', findings.length);
for (const f of findings.slice(0, 40)) console.log('-', f.name, f.file);
if (hard.length) {
  console.log('SCAN_FAIL hardcoded_login_pass', hard.length);
  process.exit(1);
}
console.log('SCAN_OK');
process.exit(0);
