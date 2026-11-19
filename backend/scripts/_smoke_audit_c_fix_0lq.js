#!/usr/bin/env node
/** Smoke 0lq — board snippet strip + exports */
const assert = require('assert');
const lead = require('../services/leadScoring');

const raw =
  '[уточнение к твоей фразе «Телега не всегда работает»]: Телега не всегда работает';
const cleaned = lead.cleanBoardSnippet(raw);
assert.ok(!/уточнение к твоей фразе/i.test(cleaned), 'marker stripped');
assert.ok(/Телега не всегда работает/i.test(cleaned), 'body kept');
assert.strictEqual(
  lead.cleanBoardSnippet('[ответ на его сообщение «Из-за чего»]: Из-за чего'),
  'Из-за чего',
);
assert.ok(typeof lead.cleanBoardSnippet === 'function');
console.log('OK smoke_audit_c_fix_0lq');
process.exit(0);
