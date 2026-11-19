const a = require('../services/aiResponder');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else console.log('ok:', msg);
}

assert(
  !/сходу/i.test(a.fixGenericAskDodge('мм не знаю сходу)', 'Когда переезд?', [])),
  'dodge not сходу: ' + a.fixGenericAskDodge('мм не знаю сходу)', 'Когда переезд?', []),
);

const media = a.fixPeerMediaReaction(
  'ого, интересный момент) выглядит, как что-то важное обсуждают',
  '[Фото от собеседника] люди за столом',
);
assert(!/выглядит|интересный момент|обсужда/i.test(media), 'media caption: ' + media);

const hi = a.fixStiffGreeting('приветик) рада видеть', 'привет');
assert(!/рада видеть/i.test(hi), 'hi stiff: ' + hi);

const mom = a.fixMomSupportFormal('мама нуждается в поддержке рядом');
assert(!/нуждается|поддержк/i.test(mom), 'mom: ' + mom);

console.log('done', process.exitCode || 0);
