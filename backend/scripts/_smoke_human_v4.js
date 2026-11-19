const a = require('../services/aiResponder');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else console.log('ok:', msg);
}

// 1) Уклоны: после недавнего dodge — не тот же шаблон снова
const histDodge = [{ role: 'assistant', content: 'короче хз)' }];
const soft = a.pickAskFallback('А когда переезд?', histDodge);
assert(!/^короче хз\s*\)*$/i.test(soft), 'no repeat dodge: ' + soft);
assert(!/^ну смотря\s*\)*$/i.test(soft), 'no смотря after dodge: ' + soft);

const fromStamp = a.fixGenericAskDodge('мм не знаю сходу)', 'Когда переезд?', histDodge);
assert(!/сходу/i.test(fromStamp), 'no сходу: ' + fromStamp);
assert(
  /бывает|зависит|получится|решила|видно|пока|думаю|расскажу|смотря|хз/i.test(fromStamp),
  'soft-ish fallback: ' + fromStamp,
);

// 2) Редакторский тон
const ed = a.fixEditorialTone('поняла, что ты шутник)', 'хах ну да шучу');
assert(!/шутник|про стиль/i.test(ed), 'editorial: ' + ed);

const ed2 = a.fixEditorialTone('мм про стиль общения интересный)', 'ну ладно');
assert(!/про стиль|интересный/i.test(ed2), 'editorial style: ' + ed2);

// 3) Coach не сносит живой хвост
const coachKeep = a.fixCoachSpeak(
  'ну с рынка взяла) хороший подход к цветам',
  'Откуда букетик',
);
assert(/рынка|взяла/i.test(coachKeep), 'coach keeps living: ' + coachKeep);
assert(!/хороший подход/i.test(coachKeep), 'coach stripped: ' + coachKeep);

// 4) Каскад: кивок на вопрос → восстанавливаем
const collapsed = a.guardSubstanceCollapse('ага)', 'Сколько маме лет если не секрет', [], null, 'ru');
assert(/лет|50|пятьдесят|52|51/i.test(collapsed), 'guard age: ' + collapsed);

// 5) Whisper garbage
assert(a.looksLikeGarbageTranscript('бркшщт пллл'), 'garbage cons');
assert(a.looksLikeGarbageTranscript('asdf qwer zxcv'), 'garbage latin');
assert(!a.looksLikeGarbageTranscript('слушай я сегодня с мамой был на даче'), 'ok transcript');

const weakVoice = a.fixWeakVoiceReply(
  'ого круто что ты на даче с трактором)',
  '[Голосовое]: бркшщт пллл ммм',
);
assert(/расслышал|ещё раз|слышн|повтори/i.test(weakVoice), 'voice mishear: ' + weakVoice);

// living reply helper
assert(a.looksLikeLivingReply('за 50 уже)'), 'living age');
assert(!a.looksLikeLivingReply('ага)'), 'not living nod');

console.log('done', process.exitCode || 0);
