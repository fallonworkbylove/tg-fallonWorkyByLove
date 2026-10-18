#!/usr/bin/env node
require('dotenv').config();
const o = require('../services/objectionHandler');

const hist = [
  { role: 'assistant', content: 'слушай, а ты скок дней уже сидишь на дв?' },
  {
    role: 'user',
    content: 'ну я два дня был до этого, потом неделю не заходил. а че?',
  },
  { role: 'assistant', content: 'поняла) ну так ты уже в теме)' },
];

const clarify = o.getDvClarifyHint('Какой?', hist);
const no = o.getDvClarifyHint('привет', hist);
if (!clarify || !/ЗАПРЕЩЕНО: NFT/i.test(clarify)) {
  console.error('FAIL clarify', clarify);
  process.exit(1);
}
if (no) {
  console.error('FAIL no-op', no);
  process.exit(1);
}
console.log('OK clarify hint');
console.log(clarify.slice(0, 120) + '…');
process.exit(0);
