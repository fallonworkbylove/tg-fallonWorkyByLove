#!/usr/bin/env node
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-smoke-test';
const {
  shouldSuppressReaction,
  applyReactionGate,
  extractReaction,
} = require('../services/replyPipeline');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

check('status ask', shouldSuppressReaction('что делаешь?'));
check('status ask bare', shouldSuppressReaction('че делаешь'));
check('как дела', shouldSuppressReaction('как дела?'));
check('allow thanks', !shouldSuppressReaction('спасибо)'));
check('allow ack', !shouldSuppressReaction('ага'));
check('allow laugh', !shouldSuppressReaction('ахахах'));
check('suppress hello', shouldSuppressReaction('привет'));
check('seriozno suppress short q-ish', shouldSuppressReaction('серьёзно?') || !shouldSuppressReaction('серьёзно?'));
// «серьёзно?» не статус-ask и не whitelist — suppress (текст важнее реакции)
check('seriozno suppress', shouldSuppressReaction('серьёзно?'));

const g = applyReactionGate('что делаешь?', '👍', '');
check('gate drops react', g.reaction == null);
check('gate fills text', !!(g.outText && g.outText.length > 2));

const g2 = applyReactionGate('что делаешь?', '😂', 'дома сижу) а ты?');
check('gate keeps text', g2.outText.includes('дома') && g2.reaction == null);

const ex = extractReaction('<<REACT:👍>> дома');
check('extract still works', ex.reaction === '👍' || ex.reaction === '👍');

if (fail) {
  console.error('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_NO_REACT_ON_ASK_0GS_OK');
