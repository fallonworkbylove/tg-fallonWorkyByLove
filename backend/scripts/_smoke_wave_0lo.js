/**
 * Smoke wave 0lo: softHuman gates 1–4,6–12.
 */
const path = require('path');
const g = require(path.join(__dirname, '../services/softHumanGates'));
const lite = require(path.join(__dirname, '../services/softHumanLite'));

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

// 2 emoji echo
{
  const hist = [{ role: 'assistant', content: 'ахаха' }];
  const out = g.fixEmojiLaughEcho('😂😂', hist);
  assert(out !== '😂😂' && /хех|ладно|эм|ок|ну ты/i.test(out), 'emoji echo');
}

// 6 sticker
{
  const out = g.fixStickerShortReply(
    'вау какой крутой стикер, очень смешно и мило, расскажи ещё)',
    '[стикер от собеседника]: кот',
  );
  assert(out.length < 40, 'sticker short');
}

// 7 clarify
{
  const out = g.fixClarifyAskReply(
    'дома сижу жду посылку и собираюсь гулять потом ещё сериал',
    'что?',
  );
  assert(!/посылк|сериал/i.test(out), 'clarify not day');
}

// 8 nft scam
{
  const out = g.fixNftScamObjection(
    'переведи мне деньги на карту срочно гарант 100%',
    'это же развод пирамида',
  );
  assert(!/перевед|гарант/i.test(out), 'nft scam bank');
}

// 9 language stick
{
  const hist = [
    { role: 'user', content: 'hey how are you doing today' },
    { role: 'user', content: 'what about the nft thing' },
  ];
  const out = g.fixLanguageStick('да всё норм, дома сижу жду посылку)', hist, 'ok cool');
  assert(!/[а-яё]{4,}/i.test(out) || /haha|lol|yeah|wait|oh ok/i.test(out), 'en stick');
}

// 10 blind photo
{
  const out = g.fixBlindPhotoReply(
    'на фото море и закат красивый пейзаж',
    '[фото от собеседника]: —\nне удалось распознать',
  );
  assert(/не разгля|плохо видно|не разобр|не рассмотре/i.test(out), 'blind photo');
}

// 11 after circle
{
  const hist = [{ role: 'assistant', content: '<<CIRCLE>> привет с концерта' }];
  const long =
    'ну смотри я сейчас расскажу очень длинную историю про то как я собиралась и ждала посылку и потом гуляла и ещё сериал смотрела целый вечер без остановки)';
  const out = g.fixLongAfterCircle(long, hist);
  assert(out.length < long.length, 'after circle shorter');
}

// 4 repeat work ask
{
  const hist = [{ role: 'assistant', content: 'ну как там на работе?)' }];
  const out = g.fixRepeatWorkAsk('а как на работе сегодня?)', hist);
  assert(!/на работе/i.test(out), 'no repeat work ask');
}

// 1 topic drift
{
  const hist = [
    { role: 'user', content: 'вчера футбол смотрел' },
    { role: 'user', content: 'ладно, что ел на ужин' },
  ];
  const out = g.fixTopicDriftReply(
    'да, матч был огонь, твоя команда забила',
    hist,
    'что ел на ужин',
  );
  assert(!/матч|команд/i.test(out), 'topic drift');
}

// 12 heard overuse
{
  const hist = [
    { role: 'assistant', content: 'флипаю токены, слышал о таком?)' },
    { role: 'assistant', content: 'ну вот так, слышал о таком?)' },
  ];
  const out = g.fixHeardTailOveruse('работаю онлайн, слышал о таком?)', hist);
  assert(!/слышал о таком/i.test(out), 'heard overuse');
}

// applySoftLite wires wave
{
  const out = lite.applySoftLite(
    '😂😂😂',
    [{ role: 'assistant', content: 'ахаха' }],
    'lol',
  );
  assert(typeof out === 'string' && out.length > 0, 'applySoftLite');
}

assert(typeof g.applyWave0loGates === 'function', 'export applyWave0loGates');
assert(typeof g.mskHour === 'function', 'mskHour');

console.log('OK wave_0lo');
process.exit(0);
