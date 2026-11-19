/**
 * Локальный/VPS smoke фиксов 10/10 без Telegram.
 */
require('dotenv').config({ quiet: true });
const soft = require('../services/softHumanLite');
const {
  stripLeakedMediaHistoryTag,
  stripMediaPromise,
  pickMediaFailDeflect,
  isMediaPromiseText,
  isHardMediaRequest,
  resolveMediaPromise,
  userNudgesPromisedMedia,
  extractMediaRequest,
  BARE_MEDIA_FILLER_RE,
} = require('../services/mediaSend');
const {
  pickMediaByContext,
  isSpecificMediaSceneRequest,
} = require('../services/mediaReplies');
const humanExtra = require('../services/humanExtra');

let fail = 0;
function ok(name, cond) {
  if (!cond) {
    console.error('FAIL', name);
    fail += 1;
  } else {
    console.log('ok', name);
  }
}

ok('afterthought_off', humanExtra.pickAfterthought('ну норм день)') == null);
const cutAeshe = soft.softCompleteCut('а ещё)');
ok('soft_cut_aeshe', !/^а\s+ещё/i.test(cutAeshe) && String(cutAeshe).length > 8);
ok(
  'enrich_ack',
  !/^ага\)?$/i.test(
    soft.enrichBareAckOnSubstance('ага', 'Я с советского района живу'),
  ),
);
ok(
  'enrich_ack_kruto',
  !/^круто\)?$/i.test(
    soft.enrichBareAckOnSubstance('круто)', 'Вчера ездил в Калугу на выходные'),
  ),
);
ok(
  'enrich_skip_short_user',
  soft.enrichBareAckOnSubstance('ага)', 'ок') === 'ага)',
);
ok(
  'ensure_ack_not_bare',
  soft.ensureAckNotBare('ну да)').length > 8 &&
    !/^ну\s+да\)?$/i.test(soft.ensureAckNotBare('ну да)')),
);
ok(
  'apply_soft_no_bare',
  !/^(?:ага|ну да|хм ок)\)?$/i.test(
    soft.applySoftLite('ну да)', [], 'Всегда по разному бывает'),
  ),
);

const leak1 = stripLeakedMediaHistoryTag('[отправила фото: Селфи вот');
ok('strip_unclosed_sent_photo', !/отправила фото/i.test(leak1.text) && leak1.leakedType === 'photo');

const leak2 = stripLeakedMediaHistoryTag('[медиа:#12] {фото: пляж} ну а ты?');
ok('strip_media_tag', !/медиа:#|фото:/.test(leak2.text) && /ну а ты/.test(leak2.text));

ok(
  'strip_media_promise_find_send',
  stripMediaPromise('щас поищу и скину') === '',
);
ok(
  'strip_media_promise_remnant',
  stripMediaPromise('и скину') === '' && stripMediaPromise('подожди немного)') === '',
);
ok(
  'strip_media_keeps_reaction',
  /класс/.test(stripMediaPromise('класс) щас поищу фотку')),
);
ok('specific_scene_boxes', isSpecificMediaSceneRequest('Блин скинь хоть фото коробок'));
ok('specific_scene_generic_off', !isSpecificMediaSceneRequest('Кинь фоточку)'));

const noMatch = pickMediaByContext(
  [{ id: 1, type: 'photo' }, { id: 2, type: 'photo' }],
  'photo',
  new Set(),
  { 1: 'Сижу в машине вечером', 2: 'Селфи дома улыбаюсь' },
  'скинь фото коробок',
  { requireMatch: true },
);
ok('pick_no_random_on_boxes', noMatch == null);

const packHit = pickMediaByContext(
  [{ id: 3, type: 'photo' }],
  'photo',
  new Set(),
  { 3: 'Сижу среди коробок на полу, собираю вещи' },
  'скинь фото коробок',
);
ok('pick_match_boxes', packHit && packHit.id === 3);

ok(
  'deflect_scene_boxes',
  /нет|такого|под рукой/i.test(pickMediaFailDeflect('фото коробок')),
);

const flat = soft.softCompleteCut('прикольно');
ok('soft_cut_prikolno', !/^прикольно\)?$/i.test(flat) && String(flat).length > 6);
ok(
  'soft_cut_tochno',
  !/^да,\s*это\s+точно\)?$/i.test(soft.softCompleteCut('да, это точно)')),
);
ok(
  'humanize_nu_tipa',
  !/ну\s+типа\s+ух\s+ты/i.test(
    soft.humanizeChatTexture('ну типа ух ты, интересный выбор'),
  ),
);

ok(
  'cute_promise_detect',
  isMediaPromiseText('просто ) что-то милое на утро отправлю)') &&
    isMediaPromiseText('ну ой, только увидела) щас скину что-то милое'),
);
ok('nudge_wait', userNudgesPromisedMedia('Ну я жду'));
ok('nudge_where_cute', userNudgesPromisedMedia('А где что-то милое на утро?'));
ok('nudge_will_be', userNudgesPromisedMedia('Ну что там, будет что-то милое'));

const histPromise = [
  { role: 'assistant', content: 'что-то милое на утро отправлю)' },
  { role: 'assistant', content: 'обидно будет) но я постараюсь' },
  { role: 'assistant', content: 'с добрым утром)' },
];
ok(
  'hard_on_where_cute',
  isHardMediaRequest('А где что-то милое на утро?', histPromise),
);
ok('hard_on_wait', isHardMediaRequest('Ну я жду', histPromise));

const forceCute = resolveMediaPromise(
  'щас скину что-то милое',
  null,
  'Эй',
  histPromise,
  true,
);
ok('force_cute_on_debt', forceCute.forceMedia === true && forceCute.preferPhoto === true);
ok(
  'strip_cute_promise',
  !/скину|милое/i.test(stripMediaPromise('ну ой, только увидела) щас скину что-то милое')) &&
    /увидела|ой/i.test(stripMediaPromise('ну ой, только увидела) щас скину что-то милое')),
);

const leakTicket = extractMediaRequest('короче вот, держи) [фото билета] как тебе?');
ok(
  'leak_ticket_forces_photo',
  leakTicket.fromLeak === true &&
    leakTicket.mediaType === 'photo' &&
    !/фото билета|\[/.test(leakTicket.text) &&
    /держи|как тебе/i.test(leakTicket.text),
);
const leakSent = extractMediaRequest('[отправила фото билета] вот, держи');
ok(
  'leak_sent_photo_tag',
  leakSent.fromLeak && leakSent.mediaType === 'photo' && !/отправила|билет/.test(leakSent.text),
);
const leakSelfie = extractMediaRequest('[отправила фото: Селфи]');
ok('leak_unclosed_selfie', leakSelfie.fromLeak && leakSelfie.mediaType === 'photo');

ok('where_photo_hard', isHardMediaRequest('Где фото?', []));
ok('where_ticket_hard', isHardMediaRequest('Но фото билета где?', histPromise));
ok('bare_filler_re', BARE_MEDIA_FILLER_RE.test('ничего особенного)'));
ok('specific_ticket', isSpecificMediaSceneRequest('фото билета'));
ok(
  'no_selfie_for_ticket',
  pickMediaByContext(
    [{ id: 9, type: 'photo' }],
    'photo',
    new Set(),
    { 9: 'Селфи дома улыбаюсь' },
    'фото билета',
    { requireMatch: true },
  ) == null,
);
ok('deflect_ticket', /билет|такого|нет/i.test(pickMediaFailDeflect('фото билета')));

if (fail) {
  console.error('failed', fail);
  process.exit(1);
}
console.log('smoke_10of10_fixes_ok');
