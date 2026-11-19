require('dotenv').config();
const inbound = require('../services/inbound');
console.log('inbound.DEFER_MIN_HISTORY', inbound.DEFER_MIN_HISTORY);
console.log('inbound.DEFER_CHANCE', inbound.DEFER_CHANCE);
console.log('inbound.DEFER_INTERRUPT_DELAY_MS', inbound.DEFER_INTERRUPT_DELAY_MS);

// Simulate replyPipeline destructure
const {
  DEFER_MIN_HISTORY,
  DEFER_CHANCE,
  DEFER_INTERRUPT_DELAY_MS,
} = inbound;
console.log('destructured', { DEFER_MIN_HISTORY, DEFER_CHANCE, DEFER_INTERRUPT_DELAY_MS });

const rp = require('../services/replyPipeline');
console.log('processBufferedMessages', typeof rp.processBufferedMessages);

// Force evaluate the branch condition style
const history = [1, 2, 3, 4, 5];
console.log('cond', history.length >= DEFER_MIN_HISTORY && Math.random() < DEFER_CHANCE);
