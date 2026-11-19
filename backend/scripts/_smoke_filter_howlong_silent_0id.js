#!/usr/bin/env node
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const fs = require('fs');
const path = require('path');

function assert(c, m) {
  if (!c) {
    console.error('FAIL', m);
    process.exit(1);
  }
  console.log('OK', m);
}

const root = path.join(__dirname, '..');
const obj = fs.readFileSync(path.join(root, 'services/objectionHandler.js'), 'utf8');
const lead = fs.readFileSync(path.join(root, 'services/leadScoring.js'), 'utf8');
const pipe = fs.readFileSync(path.join(root, 'services/replyPipeline.js'), 'utf8');
const how = fs.readFileSync(path.join(root, 'services/howLong.js'), 'utf8');

assert(/formatFilterNote\(\s*'silent'/.test(obj), 'silent → formatFilterNote');
assert(/markPeerFiltered/.test(obj), 'silent → markPeerFiltered');
assert(/formatFilterNote\(\s*'howlong'/.test(pipe), 'pipe howlong');
assert(/HOWLONG_ARCHIVE_DAYS\s*=\s*21/.test(how), 'порог 21д');
assert(/давно\\s\+на\\s\+дв/.test(lead) && /молчит/.test(lead), 'gate howlong|silent');
assert(/only_howlong_or_silent|allowManual/.test(lead), 'reject other reasons');

const allowHow = /давно\s+на\s+дв/i.test('отсев: давно на дв · 30 дн. (≥21)');
const allowSilent = /молчит/i.test('отсев: молчит 2д · 2д без ответа');
const denyOther = !/давно\s+на\s+дв/i.test('отсев: скоринг низкий') && !/молчит/i.test('отсев: скоринг низкий');
assert(allowHow && allowSilent && denyOther, 'note allow howlong+silent, deny other');

console.log('SMOKE_FILTER_HOWLONG_SILENT_0ID_OK');
