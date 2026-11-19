#!/usr/bin/env node
/**
 * Smoke: Must/Should/Nice humanHardening + wiring.
 */
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

const path = require('path');

const hh = require('../services/humanHardening');
const voice = require('../services/voiceReplies');
const objection = require('../services/objectionHandler');
const nft = require('../services/nftCampaign');

let failed = 0;
function check(name, ok) {
  if (ok) console.log(`OK  ${name}`);
  else {
    console.error(`FAIL ${name}`);
    failed += 1;
  }
}

async function main() {
  // --- Must #41/#65 clone ---
  check('clone skeptic detect', hh.isCloneSkeptic('Ты уже вторая девушка такая же'));
  check('clone skeptic bot', hh.isCloneSkeptic('ты бот чтоли'));
  check(
    'detectHint clone',
    /копипаста|совпадение|НЕ питчи/i.test(String(objection.detectHint('вы все одинаковые') || '')),
  );

  // --- voice: no flip / no voice on hostile ---
  const quoted =
    '[ответ на «я флипаю токены»]: Ты уже вторая девушка';
  check('voice null on clone quote', voice.findVoiceForText(quoted) == null);
  check('textReply null on clone', voice.findTextReplyForText(quoted) == null);
  check(
    'textForVoiceMatch strips quote',
    !/флипаю/.test(voice.textForVoiceMatch(quoted)) ||
      /вторая/.test(voice.textForVoiceMatch(quoted)),
  );

  // --- Must #66 interest gate (0gv: hits не блокируют, flip/clone — да) ---
  const aid = 9001;
  const pid = 'peer-smoke';
  check('allow nft without interest hits', !hh.shouldBlockNftPitch(aid, pid, 'привет', []));
  hh.noteExplicitInterest(aid, pid, 'расскажи про флип токены');
  hh.noteExplicitInterest(aid, pid, 'а как это работает с nft?');
  check(
    'allow after interests (no cool)',
    !hh.shouldBlockNftPitch(aid, pid, 'ок понял про флип', []),
  );
  hh.noteFlipPhotoSent(aid, pid);
  check('block after flip photo 24h', hh.shouldBlockNftPitch(aid, pid, 'ещё раз про флип', []));

  check(
    'suppressNft clone',
    (await nft.shouldSuppressNftForTurn('все вы одинаковые', { history: [] })) === true,
  );
  check(
    'suppressNft bare hello not by interest',
    (await nft.shouldSuppressNftForTurn('привет', {
      accountId: 9002,
      peerId: 'p2',
      history: [],
    })) === false,
  );

  // --- postfilters ---
  const histPon = [
    { role: 'assistant', content: 'поняла)' },
    { role: 'assistant', content: 'поняла)' },
    { role: 'user', content: 'да' },
  ];
  check(
    'strip repeat поняла',
    !/^поняла/i.test(hh.stripRepeatPonialaHah('поняла ну да)', histPon)),
  );

  const histIntro = [
    { role: 'assistant', content: 'я обычная девчонка из донецка, занимаюсь флипом токенов' },
    { role: 'user', content: 'ок' },
  ];
  check(
    'strip repeat self intro',
    !/девчонка из/i.test(
      hh.stripRepeatSelfIntro('я обычная девчонка из донецка занимаюсь флипом', histIntro),
    ),
  );

  check(
    'strip appearance on foreign media',
    /картинка|скрин/i.test(
      hh.stripAppearanceOnForeign('борода тебе к лицу)', 'это фото nft meebit'),
    ),
  );

  check(
    'strip ? if he asked',
    !/[?]/.test(hh.stripQuestionIfHeAsked('ну да а ты как?', 'что делаешь?')),
  );

  for (let i = 0; i < 5; i++) {
    hh.registerOutgoing(aid, 'короче ладно давай потом как-нибудь');
  }
  check(
    'phrase ban trips',
    hh.isPhraseBanned(aid, 'короче ладно давай потом как-нибудь'),
  );
  const filtered = hh.applyHardeningPostfilters(
    'короче ладно давай потом как-нибудь',
    [],
    'ок',
    aid,
  );
  check('phrase ban replaces', filtered !== 'короче ладно давай потом как-нибудь');

  check(
    'clone strips nft out',
    !/флип|нфт|токен/i.test(
      hh.applyHardeningPostfilters('ну да флипаю токены)', [], 'ты бот', aid),
    ),
  );

  // peer tier
  check('tier stranger', hh.peerTier([]) === 'stranger');
  check(
    'tier warm',
    hh.peerTier(Array.from({ length: 10 }, () => ({ role: 'user', content: 'x' }))) === 'warm',
  );

  // diary / deferred
  const diary = hh.ensureDiary(aid);
  check('diary lines', Array.isArray(diary.lines) && diary.lines.length >= 1);
  hh.scheduleDeferredMedia(aid, pid, { delayMs: 0, kind: 'photo' });
  const due = hh.takeDueDeferredMedia(aid, pid);
  check('deferred media due', !!due && due.kind === 'photo');

  check('human score', typeof hh.computeHumanScore(aid).score === 'number');

  // soft wiring presence
  const softSrc = require('fs').readFileSync(
    path.join(__dirname, '../services/aiResponder.js'),
    'utf8',
  );
  check('aiResponder wires hardening', /humanHardening/.test(softSrc));
  const pipeSrc = require('fs').readFileSync(
    path.join(__dirname, '../services/replyPipeline.js'),
    'utf8',
  );
  check('pipeline requires hardening', /require\('\.\/humanHardening'\)/.test(pipeSrc));
  check('pipeline skipClone hints', /skipClone:\s*true/.test(pipeSrc));

  if (failed) {
    console.error(`\n${failed} failed`);
    process.exit(1);
  }
  console.log('\nALL PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
