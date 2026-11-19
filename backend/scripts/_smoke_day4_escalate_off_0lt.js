#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ops = fs.readFileSync(path.join(__dirname, '../services/opsQuality.js'), 'utf8');
if (/runDay4EscalateWatch\(\)\.catch/.test(ops)) {
  console.error('FAIL still scheduled');
  process.exit(1);
}
if (!/async function runDay4EscalateWatch\(\)\s*\{\s*return;\s*\}/.test(ops.replace(/\r/g, ''))) {
  // loose: must early-return and not sendAdminAlert Day4
  if (/Day4 эскалация/.test(ops)) {
    console.error('FAIL still has Day4 alert text');
    process.exit(1);
  }
}
const oq = require('../services/opsQuality');
Promise.resolve(oq.runDay4EscalateWatch())
  .then(() => {
    console.log('OK day4_escalate_off');
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
