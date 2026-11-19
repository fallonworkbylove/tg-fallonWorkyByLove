#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '../services/replyPipeline.js');
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('async function fireReengage');
const end = s.indexOf('\nasync function processBufferedMessages');
if (start < 0 || end < 0) throw new Error('markers not found');
let fn = s.slice(start, end);

const needle =
  '  reengageInFlight.add(key);\n' +
  '  try {\n' +
  "    require('./scaleOps').clearBusy(accountId, peerId).catch(() => {});\n" +
  '  } catch (_) {}\n' +
  '  if (!entry) {\n' +
  '    reengageInFlight.delete(key);\n' +
  '    return;\n' +
  '  }';

const repl =
  '  reengageInFlight.add(key);\n' +
  '  try {\n' +
  '  try {\n' +
  "    require('./scaleOps').clearBusy(accountId, peerId).catch(() => {});\n" +
  '  } catch (_) {}\n' +
  '  if (!entry) {\n' +
  '    return;\n' +
  '  }';

if (!fn.includes(needle)) {
  // already wrapped or different formatting
  if (fn.includes('reengageInFlight.add(key);\n  try {\n  try {')) {
    console.log('already wrapped');
  } else {
    throw new Error('needle not found:\n' + fn.slice(fn.indexOf('reengageInFlight.add'), fn.indexOf('reengageInFlight.add') + 400));
  }
} else {
  fn = fn.replace(needle, repl);
  // close outer try: the existing finally already deletes — wrap it
  const fin =
    '  } finally {\n' +
    '    reengageInFlight.delete(key);\n' +
    '  }\n' +
    '}';
  const fin2 =
    '  } finally {\n' +
    '    /* generate */\n' +
    '  }\n' +
    '  } finally {\n' +
    '    reengageInFlight.delete(key);\n' +
    '  }\n' +
    '}';
  if (!fn.includes(fin)) throw new Error('finally block not found');
  fn = fn.replace(fin, fin2);
  s = s.slice(0, start) + fn + s.slice(end);
  fs.writeFileSync(p, s);
  console.log('OK wrapped fireReengage');
}
