#!/usr/bin/env node
/**
 * Smoke: ответы «на отъебись» — echoLength не режет нормальные реплики,
 * shortBurst не кромсает средние фразы, soft/thin не подменяют на «ага)».
 */
const h = require('../services/humanExtra');
const soft = require('../services/softHumanLite');
const thin = require('../services/humanThinLayer');
const speech = require('../services/humanizeSpeech');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

// 1) echoLength: только на голые ack
const longReply =
  'ну да, вчера ездила к родителям, потом ещё сериал досмотрела и легла поздно)';
assert(h.echoLengthClip('ок', longReply).length < longReply.length, 'echo clips bare ok');
assert(h.echoLengthClip('ага)', longReply).length < longReply.length, 'echo clips ага');
assert(
  h.echoLengthClip('почему?', longReply) === longReply,
  'echo keeps full on почему?',
);
assert(
  h.echoLengthClip('в смысле?', longReply) === longReply,
  'echo keeps full on в смысле?',
);
assert(
  h.echoLengthClip('а как ты туда попала?', longReply) === longReply,
  'echo keeps full on normal question',
);
assert(
  h.echoLengthClip('вчера машину чинил весь день', longReply) === longReply,
  'echo keeps full on substance',
);

// 2) anti-mirror не сносит весь ответ
const mirrored = h.stripAntiMirror('норм, дома сижу) а ты?', 'а ты как?');
assert(/норм|дома/i.test(mirrored) && mirrored.length >= 8, 'antiMirror keeps substance: ' + mirrored);

// 3) softHumanLite: coachy strip не → «ага)»
const coachy = 'не переживай, всё будет хорошо, главное беречь себя)';
const softOut = soft.softenCoachy(coachy);
assert(
  !/^(?:ага|поняла|хм ок|ладно)\)\s*$/i.test(String(softOut).replace(/<<[^>]+>>/g, '').trim()),
  'soft not stub: ' + softOut,
);

// 4) thinLayer fixCoachSpeak не → stub
const coachReply = 'хороший подход, зависит от восприятия ситуации)';
const fixedCoach = thin.fixCoachSpeak(coachReply);
assert(
  !/^(?:ага|поняла|хм ок)\)\s*$/i.test(String(fixedCoach).replace(/<<[^>]+>>/g, '').trim()),
  'thin coach not stub: ' + fixedCoach,
);

// 5) shortBurst: средние фразы не режем (chance forced via profile)
const mid =
  'ну вчера ездила к маме потом ещё в магазин заскочила)';
const profile = { shortBurstChance: 1, bareEndChance: 0 };
const burst = speech.maybeShortBurst(mid, profile, 'ru');
assert(burst === mid || burst.split(/\s+/).length >= 8, 'shortBurst keeps mid: ' + burst);

const multi = 'о круто)\nрасскажи как прошло)';
assert(speech.maybeShortBurst(multi, profile, 'ru') === multi, 'shortBurst keeps multiline');

console.log('SHALLOW_REPLY', process.exitCode ? 'FAIL' : 'OK');
process.exit(process.exitCode || 0);
