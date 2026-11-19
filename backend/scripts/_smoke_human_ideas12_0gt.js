#!/usr/bin/env node
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-smoke';
const i12 = require('../services/humanIdeas12');
const fs = require('fs');
const path = require('path');

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.log('FAIL', name, detail || '');
  }
}

check('status ask', i12.isStatusAsk('что делаешь?'));
const a = i12.pickStatusAskLine(1, 'p1');
const b = i12.pickStatusAskLine(1, 'p1');
check('status rotate pool', i12.STATUS_POOL.length >= 20);
check('status picks', !!a && a.length > 5);

check(
  'tone cold',
  /холодн|суше/i.test(i12.toneHint('отстань не пиши') || ''),
);
check(
  'tone warm',
  /тёпл|мягче/i.test(i12.toneHint('ты милая ❤') || ''),
);

const multi = i12.stripMultiSelfFacts(
  'я из Москвы. работаю в офисе. у меня есть кот. настроение норм.',
);
const factHits = [
  /я из/i,
  /работаю/i,
  /кот/i,
  /настроен/i,
].filter((re) => re.test(multi)).length;
check('one fact', factHits <= 2, multi);

const hist = [
  { role: 'assistant', content: 'как дела?' },
  { role: 'user', content: 'норм' },
  { role: 'assistant', content: 'чем занят?' },
  { role: 'user', content: 'работа' },
];
check('anti Q hint', !!i12.antiInterrogationHint(hist));
const noQ = i12.stripQuestionsIfInterrogating('ты где живёшь?', hist);
check('strip Q', !/\?/.test(noQ), noQ);

check(
  'false mishear',
  !/не расслышал/i.test(
    i12.stripFalseMishear('не расслышала)', 'привет как дела'),
  ),
);
check(
  'real mishear keep',
  /не расслышал|чего-чего/i.test(
    i12.stripFalseMishear('не расслышала)', '[Голосовое]: ыыыы'),
  ),
);

check(
  'photo no nft',
  !/nft|флип|токен/i.test(
    i12.stripNftPitchOnCasualPhoto(
      'о круто) я токены флипаю кстати',
      '[фото]: закат',
    ),
  ),
);
check('tod hint', !!i12.timeOfDayHint());
check('defer detect', i12.detectDeferredInterest('интересно, потом расскажи)'));

const hh = fs.readFileSync(path.join(__dirname, '../services/humanHardening.js'), 'utf8');
check('hh wires i12 hints', /humanIdeas12/.test(hh) && /buildIdeas12Hints/.test(hh));
check('hh wires i12 post', /applyIdeas12Postfilters/.test(hh));

const ops = fs.readFileSync(path.join(__dirname, '../services/opsQuality.js'), 'utf8');
check('proxy watch', /runProxyAliveWatch/.test(ops));
check('session watch', /runSessionCountWatch/.test(ops));

const ai = fs.readFileSync(path.join(__dirname, '../services/aiResponder.js'), 'utf8');
check('openai proxy split', /OPENAI_PROXY_LIST/.test(ai));

const pipe = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
check('emotion whitelist', /EMOTION_REACT_ALLOW_RE/.test(pipe));
check('deferred schedule', /deferred_interest/.test(pipe));

const cp = fs.readFileSync(path.join(__dirname, '../services/clientPool.js'), 'utf8');
check('active count export', /getActiveClientCount/.test(cp));

if (fail) {
  console.error('SMOKE_FAIL', fail);
  process.exit(1);
}
console.log('SMOKE_HUMAN_IDEAS12_0GT_OK');
