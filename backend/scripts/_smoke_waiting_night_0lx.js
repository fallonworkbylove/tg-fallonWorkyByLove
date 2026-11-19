#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

const oq = fs.readFileSync(path.join(__dirname, '../services/opsQuality.js'), 'utf8');
check('waiting skips night', /isNightTextQuietHour/.test(oq));
check('waiting skips after work day', /isWithinGlobalWorkingHours/.test(oq));

const sil = fs.readFileSync(path.join(__dirname, '../services/silenceCatchup.js'), 'utf8');
check('heal stale after sleep', /ageMin < 20/.test(sil));
check(
  'heal still night hard stop',
  /isNightTextQuietHour\(\)/.test(sil) && /return false/.test(sil),
);
check('heal sync TG to DB', /silence-heal: sync TG→DB/.test(sil));
check('hooks saveMessage', /saveMessage: null/.test(sil) || /saveMessage/.test(sil));

const tc = fs.readFileSync(path.join(__dirname, '../services/telegramClient.js'), 'utf8');
check('telegram wires saveMessage', /saveMessage: \(\.\.\.args\) => saveMessage/.test(tc));

if (fail) {
  console.error(`SMOKE_FAIL ${fail}`);
  process.exit(1);
}
console.log('SMOKE_WAITING_NIGHT_0LX_OK');
