#!/usr/bin/env node
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_PROXY_LIST = '';
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
function ok(name, cond, detail = '') {
  if (cond) {
    console.log(`OK  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const ideas14Src = fs.readFileSync(path.join(__dirname, '../services/humanIdeas14.js'), 'utf8');
ok('skip_until_morning_hardMedia', /opts\.hardMedia/.test(ideas14Src) || /opts && opts\.hardMedia/.test(ideas14Src));
ok('skip_day_window_7_21', /h >= 7 && h < 21/.test(ideas14Src));
ok('skip_no_allow_if_wrote', !/if \(bare\(userMessage\)\) return false;/.test(ideas14Src));

const dailySrc = fs.readFileSync(path.join(__dirname, '../services/dailyLife.js'), 'utf8');
ok('looksLikeFarewell_fn', /function looksLikeFarewell/.test(dailySrc));
const idleIdx = dailySrc.indexOf('async function sendIdlePokes');
const idleChunk = idleIdx >= 0 ? dailySrc.slice(idleIdx, idleIdx + 4000) : '';
ok(
  'idle_poke_goodbye',
  /dialogAlreadySaidGoodbye\(accountId,\s*peerId\)/.test(idleChunk),
);

const pipeSrc = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
ok('pipeline_wires_skip', /shouldSkipUntilMorning/.test(pipeSrc));
ok('pipeline_farewell_log', /после спокойной — тишина до утра/.test(pipeSrc));

const inboundSrc = fs.readFileSync(path.join(__dirname, '../services/inbound.js'), 'utf8');
ok(
  'afterthought_farewell_guard',
  /function scheduleAfterthought[\s\S]{0,350}looksLikeFarewell/.test(inboundSrc),
);

// Pure logic mirror of shouldSkipUntilMorning (no DB).
function hadRecentFarewell(history) {
  const FAREWELL_RE =
    /(?:до\s+завтра|спокойной\s+ночи|спокойно\s+ночи|баиньки|доброй\s+ночи|я\s+спать|пойду\s+спать)/i;
  return (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'assistant')
    .slice(-4)
    .some((m) => FAREWELL_RE.test(String(m.content || '')));
}
function shouldSkipUntilMorning(history, userMessage, opts = {}) {
  if (!hadRecentFarewell(history)) return false;
  if (opts && opts.hardMedia) return false;
  return true; // night path: caller sets hour via opts._forceNight
}
const hist = [{ role: 'assistant', content: 'спокойной ночи)' }];
ok('mirror_had_farewell', hadRecentFarewell(hist));
ok('mirror_hard_media', shouldSkipUntilMorning(hist, 'скинь фото', { hardMedia: true }) === false);
ok('mirror_skip_plain', shouldSkipUntilMorning(hist, 'ага', { hardMedia: false }) === true);
ok(
  'mirror_no_farewell',
  shouldSkipUntilMorning([{ role: 'assistant', content: 'норм)' }], 'ага') === false,
);

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('ALL OK');
