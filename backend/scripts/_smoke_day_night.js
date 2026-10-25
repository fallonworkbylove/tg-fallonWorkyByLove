/**
 * Скрин 25 окт: утром «доброй, отдыхай», «ночь же», ложная «весна»,
 * «фотки не прислала» → не «напомни потом».
 */
const soft = require('../services/softHumanLite');
const timeStyle = require('../services/timeStyle');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('ok:', msg);
}

// 1) Запоздалое «доброй, отдыхай)» днём → не ночь.
{
  const out = soft.fixStaleNightTalk('доброй, отдыхай)', '…');
  assert(!/доброй|спокойной|отдыхай/i.test(out), `stale goodnight → ${out}`);
}

// 2) «Уже утро, солнце» + «ночь же … а ты как день?» → признать утро.
{
  const out = soft.applySoftLite(
    'в смысле хорошего отдыха, ночь же уже а ты как день?',
    [],
    'Уже утро , солнце',
  );
  assert(!/ночь\s+же|спокойн|доброй\s+ночи/i.test(out), `morning correct → ${out}`);
  assert(!/\?/.test(out) || /утро|день/i.test(out), `no night+question → ${out}`);
}

// 3) Ложная «весна» когда он не говорил про весну.
{
  const out = soft.stripFalseSeasonCorrection(
    'хах, какая весна, осень же',
    'Уже утро , солнце',
  );
  assert(!/весн/i.test(out), `false spring → ${out}`);
}

// 4) Промпт сезона не учит копировать «какая весна».
{
  const { hint } = timeStyle.getSeasonInfo();
  assert(!/хах какая весна/i.test(hint), 'season hint without bad example');
  assert(/солнце/i.test(hint), 'season hint mentions sun≠spring');
}

// 5) «фотки не прислала» ловится как просьба медиа.
{
  const ask =
    /((что|как|ну)\s+(там\s+)?(по|с)\s+(фот|видео|видос|круж|селфи|форм)|(где|жду|ждём|ждем)\s+(же\s+|твои\s+|тво[её]\s+|ещё\s+|еще\s+)?(фот|видео|видос|круж|селфи|форм)|(фот|видео|видос|круж|селфи|форм)\w*\s+(жду|ждём|ждем|будут|будет|то\s+будут|то\s+будет|когда|есть\??|нет\??)|(нет|нету)\s+(у\s+тебя\s+)?(фот|селфи|круж|видео|форм)|(у\s+тебя\s+)?(есть|нету?)\s+(ещё\s+|еще\s+)?(фот|селфи|круж|видео|форм)|(фот|видео|видос|круж|селфи|форм)\w*.{0,40}(?:так\s+и\s+)?не\s+(?:присл|скин|кину|отправ)|(так\s+и\s+)?не\s+(?:присл|скин|кину|отправ)\w*.{0,24}(фот|видео|видос|круж|селфи|форм))/i;
  assert(
    ask.test('Фотки мне так и не прислала вчера'),
    'photos-not-sent is media ask',
  );
}

console.log('all day/night smokes passed');
