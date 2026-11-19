#!/usr/bin/env node
/**
 * Smoke humanIdeas13 (0ib).
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const i13 = require('../services/humanIdeas13');
const hh = require('../services/humanHardening');
const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
  console.log('OK', msg);
}

// 1 anketa
{
  const a = i13.softenAnketaCliche('просто общаюсь)');
  assert(!/просто\s+общаюсь/i.test(a) && a.length >= 6, `anketa whole → ${a}`);
  const b = i13.softenAnketaCliche('ищу новых знакомых и общения)');
  assert(!/ищу\s+новых/i.test(b) && !/^и\s+общен/i.test(b) && b.length >= 8, `anketa ищу → ${b}`);
}

// 2 stale how-ask
{
  const hist = [{ role: 'assistant', content: 'норм) а как дела?' }];
  const r = i13.stripStaleHowAsk('ага) а ты чем занят?', 'норм, дома', hist);
  assert(!/чем\s+занят|как\s+дела/i.test(r) || !/\?/.test(r), `stale how → ${r}`);
  const keep = i13.stripStaleHowAsk('о как) а ты чем занят?', 'слушай сериал новый вышел', []);
  assert(/чем\s+занят/i.test(keep), `keep how on topic → ${keep}`);
}

// 3 hollow promise
{
  const p = i13.softenHollowPromise('обязательно напишу завтра)');
  assert(!/обязательно\s+напишу/i.test(p), `hollow → ${p}`);
}

// 4 near echo
{
  const e = i13.stripNearEcho('дома сижу', 'дома сижу');
  assert(e !== 'дома сижу' && e.length >= 4, `echo → ${e}`);
}

// 5 weekday hint shape
{
  const fri = i13.weekdayMicroHint(new Date('2026-11-06T18:00:00+03:00')); // Fri
  assert(fri && /пятниц/i.test(fri), `friday hint → ${fri}`);
  const mon = i13.weekdayMicroHint(new Date('2026-11-02T10:00:00+03:00')); // Mon
  assert(mon && /понедельник/i.test(mon), `monday hint → ${mon}`);
}

// 6 pipeline wiring
{
  const out = i13.applyIdeas13Postfilters(
    'просто общаюсь) обязательно напишу завтра',
    [{ role: 'assistant', content: 'как дела?' }],
    'норм',
  );
  assert(!/просто\s+общаюсь/i.test(out), `apply pack anketa gone → ${out}`);
  assert(!/обязательно\s+напишу/i.test(out), `apply pack hollow gone → ${out}`);
}

// 7 hardening hooks
{
  const src = fs.readFileSync(path.join(__dirname, '../services/humanHardening.js'), 'utf8');
  assert(/humanIdeas13/.test(src) && /applyIdeas13Postfilters/.test(src), 'hardening wires ideas13');
  const filtered = hh.applyHardeningPostfilters(
    'просто общаюсь)',
    [],
    'ты тут?',
    1,
    'x',
  );
  assert(!/просто\s+общаюсь/i.test(String(filtered)), `hardening path → ${filtered}`);
}

console.log('SMOKE_IDEAS13_0IB_OK');
