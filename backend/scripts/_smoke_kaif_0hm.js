#!/usr/bin/env node
/**
 * Anti-kaif echo 0hm: user-kaif, history≥1, bare ack swap.
 */
process.env.AUDIT_SMOKE = '1';
process.env.OPENAI_PROXY_LIST = '';
const soft = require('../services/softHumanLite');

let fail = 0;
function check(name, ok, extra) {
  console.log(ok ? 'OK' : 'FAIL', name, extra || '');
  if (!ok) fail += 1;
}

function kaifOnly(t) {
  return /^(?:ну\s+|да\s+|ага\s+|угу\s+)?кайф(?:овой|овая|ики|ово)?(?:\s*[,.!)…]*)?$/i.test(
    String(t || '').trim(),
  );
}

const histLoop = [
  { role: 'assistant', content: 'ага, кайф' },
  { role: 'user', content: 'Да, кайф)' },
  { role: 'assistant', content: 'кайф)' },
  { role: 'user', content: 'Кайф)' },
];

const brokenUser = soft.breakKaifEcho('Кайф)', histLoop, 'Кайф)');
check(
  'user-kaif always pivots',
  !kaifOnly(brokenUser) && !/^кайф/i.test(String(brokenUser).trim()) && /\?/.test(brokenUser),
  '→ ' + brokenUser,
);

const histOne = [{ role: 'assistant', content: 'кайф)' }, { role: 'user', content: 'норм' }];
const brokenHist = soft.breakKaifEcho('кайф)', histOne, 'норм');
check(
  'one prior assistant kaif pivots',
  !kaifOnly(brokenHist) && /\?/.test(brokenHist),
  '→ ' + brokenHist,
);

const bare = soft.breakKaifEcho('кайф)', [], 'привет');
check(
  'bare kaif → alt ack',
  !kaifOnly(bare) && !/кайф/i.test(bare),
  '→ ' + bare,
);

const keep = soft.breakKaifEcho('сегодня тихо, сериал кручу)', [], 'как день?');
check('non-kaif untouched', keep === 'сегодня тихо, сериал кручу)');

const viaSoft = soft.applySoftLite('кайф', histLoop, 'Кайф)');
check('applySoftLite breaks loop', !kaifOnly(viaSoft) && !/^кайф/i.test(String(viaSoft).trim()), '→ ' + viaSoft);

const viaSoftOne = soft.applySoftLite('кайфики)', histOne, 'окей');
check('applySoftLite one-hit', !/кайф/i.test(viaSoftOne), '→ ' + viaSoftOne);

if (fail) {
  console.error('FAILS', fail);
  process.exit(1);
}
console.log('SMOKE_KAIF_0HM_OK');
process.exit(0);
