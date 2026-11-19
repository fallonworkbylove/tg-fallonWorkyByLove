#!/usr/bin/env node
/**
 * Flip-photo «это ты?» identity + кайф-echo break.
 * Avoid loading aiResponder (needs OPENAI_API_KEY) — require soft first,
 * and for objectionHandler set a dummy key if missing.
 */
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-test-not-real';

const soft = require('../services/softHumanLite');
const oh = require('../services/objectionHandler');

let fail = 0;
function check(name, ok) {
  console.log(ok ? 'OK' : 'FAIL', name);
  if (!ok) fail += 1;
}

const hist = [
  {
    role: 'assistant',
    content:
      '[фото от меня: скриншот прибыли с флиппинга NFT — купила дешевле, продала дороже] Подпись: "неожиданно, приятно 🙃"',
  },
  { role: 'user', content: 'Это ты?' },
];

check('asking это ты', oh.isAskingAboutSentPhoto('Это ты?'));
check('asking if her', oh.isAskingIfFlipPhotoIsHer('Это ты?'));
check('asking is this you', oh.isAskingIfFlipPhotoIsHer('is this you?'));

const hint = oh.detectHint('Это ты?', hist);
check('hint on это ты', !!(hint && /НЕ твоё селфи|это ты\?/i.test(hint)));
check('hint bans да это я', !!(hint && /ЗАПРЕЩЕНО: «да это я»/i.test(hint)));
if (!hint) console.log('  hint was', hint);

const fixedSelf = oh.softenFlipPhotoIdentityReply(
  'да, это я) немного повезло сегодня',
  'Это ты?',
  hist,
);
check('rewrite да это я', /нет/i.test(fixedSelf) && !/да,\s*это\s+я/i.test(fixedSelf));
console.log('  →', fixedSelf);

const fixedBeard = oh.softenFlipPhotoIdentityReply(
  'Борода тебе к лицу)',
  'да, это я) немного повезло сегодня',
  hist,
);
check('rewrite борода', /персонаж|нфт|nft|не ты/i.test(fixedBeard));
console.log('  →', fixedBeard);

const fixedPeer = oh.softenFlipPhotoIdentityReply('Это же ты)', 'нет, это не я, не верь', hist);
check('rewrite это же ты', /персонаж|нфт|не ты/i.test(fixedPeer));

const kaifHist = [
  { role: 'user', content: 'Кайф)' },
  { role: 'assistant', content: 'ага, кайф' },
  { role: 'user', content: 'Да, кайф)' },
  { role: 'assistant', content: 'кайф, что согласен)' },
  { role: 'user', content: 'Кайф)' },
];
const broken = soft.breakKaifEcho('Кайф)', kaifHist, 'Кайф)');
check('break kaif echo', !/^кайф/i.test(broken.trim()) && /\?/.test(broken));
console.log('  →', broken);

function kaifOnly(t) {
  return /^(?:ну\s+|да\s+|ага\s+)?кайф(?:овой|овая|ики)?(?:\s*[,.!)…]*)?$/i.test(String(t).trim());
}
const viaSoft = soft.applySoftLite('кайф', kaifHist, 'Кайф)');
check('soft lite breaks kaif', !kaifOnly(viaSoft));

if (fail) {
  console.error('FAILS', fail);
  process.exit(1);
}
console.log('SMOKE_FLIP_IDENTITY_KAIF_OK');
