#!/usr/bin/env node
require('dotenv').config();
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'local-smoke-only';
const t = require('../services/humanThinLayer');
const h = require('../services/humanizeSpeech');
const life = require('../services/lifeTexture');
require('../services/aiResponder');

const hint = t.buildThinHumanHint('вчера чинил машину', [
  { role: 'assistant', content: 'норм' },
  { role: 'user', content: 'а' },
  { role: 'assistant', content: 'ага' },
  { role: 'user', content: 'б' },
]);
if (!/машин|якорь|телефон/i.test(hint)) {
  console.error('FAIL hint', hint.slice(0, 200));
  process.exit(1);
}
const profile = h.getHumanizeProfile(42);
const bub = h.maybeDoubleBubble('норм день)\nсейчас дома)', profile, 'ru');
const punct = h.varyTerminalPunctuation('нормально.', profile, 'ru');
const rhythm = life.buildChatRhythmHint(7, 'привет как дела', [
  { role: 'user', content: 'a' },
  { role: 'assistant', content: 'b' },
  { role: 'user', content: 'c' },
]);
console.log('human_v5 OK', {
  hintBits: hint.includes('якорь'),
  doubleChance: profile.doubleBubbleChance,
  punctSample: punct,
  rhythm: rhythm ? 'sometimes' : 'none_this_roll',
});
process.exit(0);
