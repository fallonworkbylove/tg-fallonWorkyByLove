#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const scaleOps = require('../services/scaleOps');

let failed = 0;
function ok(name, cond, detail = '') {
  if (cond) console.log(`OK ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

const withFlag = scaleOps.checklistForAccount(
  { prompt: 'x'.repeat(50), has_session: 1, media_chat_link: 'https://t.me/c/1' },
  { online: true },
);
ok('has_session_flag_ok', withFlag.labels.session === true && !withFlag.missing.includes('сессия'));

const withLen = scaleOps.checklistForAccount(
  { prompt: 'x'.repeat(50), session_len: 80, media_chat_link: 'https://t.me/c/1' },
  { online: true },
);
ok('session_len_ok', withLen.labels.session === true && !withLen.missing.includes('сессия'));

const noSess = scaleOps.checklistForAccount(
  { prompt: 'x'.repeat(50), has_session: 0, media_chat_link: 'https://t.me/c/1' },
  { online: true },
);
ok('no_session_still_flags', noSess.missing.includes('сессия'));

const accSrc = fs.readFileSync(path.join(__dirname, '../routes/accounts.js'), 'utf8');
ok('list_selects_has_session', /has_session/.test(accSrc) && /session_len/.test(accSrc));
ok('list_strips_session_string', /session_string:\s*_sess/.test(accSrc) || /session_len:\s*_slen/.test(accSrc));

const scaleSrc = fs.readFileSync(path.join(__dirname, '../services/scaleOps.js'), 'utf8');
ok('checklist_reads_has_session', /has_session/.test(scaleSrc) && /session_len/.test(scaleSrc));

if (failed) {
  console.error(`FAIL count=${failed}`);
  process.exit(1);
}
console.log('OK all');
