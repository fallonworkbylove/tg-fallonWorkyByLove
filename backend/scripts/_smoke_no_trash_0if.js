#!/usr/bin/env node
/** Smoke 0if: нет автоотсева мусор/мат. */
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
const pipe = fs.readFileSync(path.join(root, 'services/replyPipeline.js'), 'utf8');
const lead = fs.readFileSync(path.join(root, 'services/leadScoring.js'), 'utf8');
const ops = fs.readFileSync(path.join(root, 'services/opsQuality.js'), 'utf8');

assert(!/trashPeerFilter/.test(pipe), 'pipe без trashPeerFilter');
assert(!/isTrashPeerMessage/.test(pipe), 'pipe без isTrashPeerMessage');
assert(!/formatFilterNote\(\s*'trash'/.test(pipe), 'pipe без trash note');
assert(!/мусор\s*→\s*отсев/.test(pipe), 'pipe без лога мусор→отсев');

assert(/давно\\s\+на\\s\+дв/.test(lead) && /молчит/.test(lead), 'gate howlong|silent');
assert(!/\/мусор\/i\.test\(finalNote\)/.test(lead), 'gate без мусор');
assert(/howlong\|молчит/.test(lead) && !/howlong\|молчит\|мусор/.test(lead), 'warn без мусор');

assert(!/trash:\s*'мусор'/.test(ops), 'FILTER_REASONS без trash');

const allowHow = /давно\s+на\s+дв/i.test('отсев: давно на дв · 30 дн.');
const allowSilent = /молчит/i.test('отсев: молчит 2д');
const denyTrash = !/давно\s+на\s+дв/i.test('отсев: мусор · мат') && !/молчит/i.test('отсев: мусор · мат');
assert(allowHow && allowSilent && denyTrash, 'note allow howlong+silent, deny trash');

console.log('SMOKE_NO_TRASH_0IF_OK');
