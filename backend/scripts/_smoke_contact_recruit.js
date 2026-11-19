const a = require('../services/aiResponder');
const o = require('../services/objectionHandler');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

assert(
  a.fixContactLeak('да, конечно, держи) [ссылка]', 'Дай ссылку') !== 'да, конечно, держи) [ссылка]',
  'contact leak on дай ссылку',
);
assert(a.fixContactLeak('норм)', 'Дай ссылку Если позволишь') !== 'норм)', 'weak agree on дай ссылку');
assert(a.fixContactLeak('ну давай', 'И какой?') !== 'ну давай', 'weak agree on ник');
assert(
  a.fixContactLeak('ой, точно, забыла) он такой же, как здесь', 'А никнейм?') !==
    'ой, точно, забыла) он такой же, как здесь',
  'same nick leak',
);

assert(o.isRecruitAccusation('Да не, ты полюбому затянуть меня хочешь'), 'recruit detect');
const r = a.fixRecruitAccusation(
  'ну не знаю, может быть',
  'Да не, ты полюбому затянуть меня хочешь',
);
assert(!/может быть/i.test(r), 'recruit hedge replaced: ' + r);

const p = a.fixDeferredPhotoPromise('не гони', 'Покажись');
assert(!/не гони/i.test(p), 'покажись not не гони: ' + p);

const h = a.fixHollowProbeQuestion('Что ок ?', 'ОК');
assert(!/^что\s+ок/i.test(h), 'hollow что ок: ' + h);
const h2 = a.fixHollowProbeQuestion('Что сложно ?', 'сложно так сразу');
assert(!/что сложно/i.test(h2), 'hollow что сложно: ' + h2);

const live = a.fixIgnoredDirectQuestion('хз сразу)', 'Ты одна живешь ?');
assert(/родител|мамой/i.test(live), 'live alone: ' + live);

console.log('done, exit', process.exitCode || 0);
