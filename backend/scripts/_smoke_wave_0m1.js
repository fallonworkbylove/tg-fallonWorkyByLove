/**
 * Smoke 0m1 — scaleIdeasPack: loop/mood/meet/toxic/bot-score/voice single/checklist.
 */
const path = require('path');
const fs = require('fs');
const pack = require(path.join(__dirname, '../services/scaleIdeasPack'));
const gates = require(path.join(__dirname, '../services/softHumanGates'));
const lite = require(path.join(__dirname, '../services/softHumanLite'));

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

// #1 topic loop
{
  const hist = [
    { role: 'assistant', content: 'ну как там на работе?)' },
    { role: 'assistant', content: 'а работа норм?)' },
    { role: 'assistant', content: 'че по работе сегодня?)' },
  ];
  const det = pack.detectTopicLoop(hist);
  assert(det.looping === true && det.topic === 'work', 'topic loop detect');
  const out = pack.fixTopicLoopReply('да работа кипит опять', hist);
  assert(!/работ/i.test(out) || /день|тем|себя|нового/i.test(out), 'topic loop rewrite');
}

// #5 mood echo
{
  assert(pack.detectMoodEcho('ахаха лол') === 'playful', 'mood playful');
  assert(pack.detectMoodEcho('ок') === 'dry', 'mood dry');
  assert(pack.detectMoodEcho('пошёл нах') === 'tense', 'mood tense');
  const h = pack.moodEchoHint('скучаю по тебе');
  assert(h.key === 'warm' && h.hint, 'mood warm hint');
}

// #6 typing mul (humanRhythm тянет mysql — проверяем mul отдельно)
{
  assert(pack.typingMoodMul('ок') < pack.typingMoodMul('пошёл нах'), 'tense slower typing');
  assert(pack.typingMoodMul('ахаха') > 0, 'playful mul');
  const hrSrc = fs.readFileSync(path.join(__dirname, '../services/humanRhythm.js'), 'utf8');
  assert(/typingMoodMul|moodMul|scaleIdeasPack/.test(hrSrc), 'humanRhythm wired mood mul');
}

// #7 soft meet
{
  const out = pack.fixSoftMeetRefuse('давай встретимся завтра у метро', 'давай встретимся');
  assert(/переезд|разъезд|пока\s+тут|после/i.test(out), 'soft meet refuse');
  const keep = pack.fixSoftMeetRefuse(
    'ой я бы с радостью, но сейчас в разъездах) давай пока тут)',
    'давай встретимся',
  );
  assert(/разъезд|пока\s+тут/i.test(keep), 'soft meet keep');
}

// #10 toxic
{
  const out = pack.fixToxicSoftMode('сам дурак иди отсюда', 'ты дура пошла нах');
  assert(/полегче|агресс|неприятно|пауз/i.test(out), 'toxic soft');
}

// #13 single NFT voice only
{
  const st = pack.nftVoiceStatus(path.join(__dirname, '../voices'));
  assert(st.file === 'nft.ogg' && st.single === true, 'single nft voice');
  assert(pack.resolveNftVoiceFile() === 'nft.ogg', 'resolve nft.ogg');
  assert(!/nft_b|nft_c|assignVoiceVariant|getVoiceAbWinner/.test(
    fs.readFileSync(path.join(__dirname, '../services/scaleIdeasPack.js'), 'utf8'),
  ), 'no ab leftovers in pack');
}

// #46 bot score
{
  const heavy =
    'Безусловно, важно отметить, что в целом таким образом я понимаю вашу ситуацию и подведём итог.';
  assert(pack.scoreBotSound(heavy) >= 7, 'bot score high');
  const light = 'о как) поняла';
  assert(pack.scoreBotSound(light) <= 3, 'bot score low');
  const fixed = pack.fixBotSoundHeavy(heavy);
  assert(fixed.length < heavy.length, 'bot score trim');
}

// #34 city tz
{
  assert(pack.cityTzOffsetMin('живу в Екатеринбурге') === 120, 'ekb tz');
  const life = pack.shiftLifeByCityTz(
    { wakeMin: 9 * 60, sleepMin: 23 * 60, afternoonMin: 15 * 60, eveningMin: 20 * 60 },
    'Ты — Кира из Владивостока',
  );
  assert(life.tzOffsetMin === 420 && life.wakeMin === 9 * 60 - 420, 'vlad tz shift');
}

// #48 checklist
{
  const md = '## 0m1. test\n## 0m0. prev\n';
  const list = pack.buildChangelogSmokeChecklist(md, { limit: 2 });
  assert(list.length === 2 && list[0].tag === '0m1', 'checklist tags');
}

// #50 creator
{
  assert(pack.isCreatorUser('fallonsociapat', null) === true, 'creator name');
  assert(pack.isCreatorUser('someone', null) === false, 'not creator');
}

// wave wiring
{
  assert(typeof gates.applyWave0m1Gates === 'function', 'gates export');
  const hist = [
    { role: 'assistant', content: 'ну как там на работе?)' },
    { role: 'assistant', content: 'а работа норм?)' },
    { role: 'assistant', content: 'че по работе?)' },
  ];
  const out = lite.applySoftLite('работа кипит снова целый день', hist, 'ну и как работа');
  assert(typeof out === 'string' && out.length > 0, 'applySoftLite 0m1');
}

// softHumanGates applyWave0m1
{
  const out = gates.applyWave0m1Gates(
    'давай встретимся завтра',
    [],
    'давай встретимся',
  );
  assert(/переезд|разъезд|пока\s+тут|после/i.test(out), 'gates soft meet');
}

console.log('SMOKE_WAVE_0M1_OK');
