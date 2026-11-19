#!/usr/bin/env node
/**
 * Единый регресс: howlong/silent + no trash + typo + nearDup wire.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(script) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stdout || '');
    console.error(r.stderr || '');
    console.error('FAIL', script);
    process.exit(1);
  }
  console.log('OK', script);
}

run('_smoke_filter_howlong_silent_0id.js');
run('_smoke_no_trash_0if.js');
run('_smoke_ideas14_0ih.js');

const pipe = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
if (!/nearDupSkip|nearDupOutbound/.test(pipe)) {
  console.error('FAIL nearDup wire');
  process.exit(1);
}
console.log('OK nearDup wire');
if (!/humanIdeas14/.test(pipe) && !fs.readFileSync(path.join(__dirname, '../services/humanHardening.js'), 'utf8').includes('humanIdeas14')) {
  console.error('FAIL ideas14 wire');
  process.exit(1);
}
console.log('OK ideas14 wire');
console.log('SMOKE_REGRESS_OK');
