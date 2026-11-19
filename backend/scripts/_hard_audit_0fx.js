#!/usr/bin/env node
/**
 * Hard audit 0fx: quiet hours, imports, churn SQL, flip identity,
 * kaif echo, flipping.ogg quote strip, frontend updates, B&W.
 * No OpenAI / no pm2 restart required.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const repo = path.join(root, '..');
let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log('OK', name);
  else {
    fail += 1;
    console.error('FAIL', name, detail || '');
  }
}
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const readB = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const timing = readB('services/timing.js');
const pipeline = readB('services/replyPipeline.js');
const daily = readB('services/dailyLife.js');
const churn = readB('services/churnLearn.js');
const oh = readB('services/objectionHandler.js');
const soft = readB('services/softHumanLite.js');
const voice = readB('services/voiceReplies.js');
const css = read('frontend/styles.css');
const updates = read('frontend/updates.js');
const index = read('frontend/index.html');
const opsPath = path.join(repo, 'ops-console', 'app', 'updates.js');
const opsUp = fs.existsSync(opsPath) ? fs.readFileSync(opsPath, 'utf8') : '';

// --- quiet hours ---
check(
  'quiet hours && not ||',
  /return\s+hour\s*>=\s*VOICE_QUIET_START_HOUR\s*&&\s*hour\s*<\s*VOICE_QUIET_END_HOUR/.test(timing),
);
check(
  'quiet hours no || bug',
  !/VOICE_QUIET_START_HOUR\s*\|\|/.test(timing) && !/hour\s*>=\s*1\s*\|\|\s*hour\s*<\s*8/.test(timing),
);

// --- imports / consts ---
check('pipeline imports lastIncomingText', /lastIncomingText,/.test(pipeline));
check('pipeline imports looksLikeFarewell', /looksLikeFarewell/.test(pipeline) && /require\('\.\/dailyLife'\)/.test(pipeline));
check('dailyLife exports looksLikeFarewell', /looksLikeFarewell,/.test(daily));
check('VOICE_REPEAT_GAP_MS defined', /const\s+VOICE_REPEAT_GAP_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/.test(pipeline));

// --- churn ---
check('churn_signal column', /churn_signal\s+VARCHAR/.test(churn));
check('no bare signal VARCHAR', !/^\s*signal\s+VARCHAR/m.test(churn));

// --- flip identity ---
check('ASKING_IF_FLIP_PHOTO', /ASKING_IF_FLIP_PHOTO_IS_HER_RE/.test(oh));
check('softenFlipPhotoIdentity', /softenFlipPhotoIdentityReply/.test(oh));
check('hint bans да это я', /ЗАПРЕЩЕНО: «да это я»/.test(oh));
check('pipeline wires softenFlip', /softenFlipPhotoIdentityReply/.test(pipeline));

// --- kaif / voice quote ---
check('breakKaifEcho', /function breakKaifEcho/.test(soft) && /breakKaifEcho\(out/.test(soft));
check('textForVoiceMatch', /function textForVoiceMatch/.test(voice));
check('FLIP_VOICE_HOSTILE', /FLIP_VOICE_HOSTILE_RE/.test(voice));
check('findVoice uses textForVoiceMatch', /textForVoiceMatch\(text\)/.test(voice));

// --- frontend ---
check('css B&W primary', /--primary:\s*#e8e8e8/.test(css));
check('index updates v103+', /updates\.js\?v=(10[3-9]|1[1-9]\d)/.test(index));
check('updates flip voice entry', /голосовую предложку|предложка только когда/i.test(updates));
check('updates screenshot identity', /Скрин сделки|это я/i.test(updates));
if (opsUp) {
  check('ops updates flip voice', /голосовую предложку|предложка только когда/i.test(opsUp));
  check('ops updates identity', /Скрин сделки|это я/i.test(opsUp));
} else {
  check('ops updates optional locally', true);
}

// --- runtime (no OpenAI key needed for these) ---
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'sk-smoke-hard-audit';

const softM = require('../services/softHumanLite');
const voiceM = require('../services/voiceReplies');
const ohM = require('../services/objectionHandler');
const { isVoiceQuietHour } = require('../services/timing');

const histFlip = [
  {
    role: 'assistant',
    content:
      '[фото от меня: скриншот прибыли с флиппинга NFT — купила дешевле, продала дороже]',
  },
];
const fixed = ohM.softenFlipPhotoIdentityReply(
  'да, это я) немного повезло сегодня',
  'Это ты?',
  histFlip,
);
check('runtime rewrite да это я', /нет/i.test(fixed) && !/да,\s*это\s+я/i.test(fixed));

const quoted =
  '[ответ на «я занимаюсь флипингом цифровых токенов»]: Ты второй девушка уже 😂';
check('runtime no flip voice on quote', voiceM.findVoiceForText(quoted) == null);

const kaifHist = [
  { role: 'assistant', content: 'ага, кайф' },
  { role: 'assistant', content: 'кайф' },
];
const broken = softM.breakKaifEcho('кайф', kaifHist, 'Кайф)');
check('runtime break kaif', !/^кайф/i.test(String(broken).trim()) && /\?/.test(broken));

check('runtime isVoiceQuietHour is fn', typeof isVoiceQuietHour === 'function');

console.log(fail ? `HARD_0FX_FAIL ${fail}` : 'HARD_0FX_OK');
process.exit(fail ? 1 : 0);
