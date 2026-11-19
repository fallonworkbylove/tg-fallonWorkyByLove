#!/usr/bin/env node
/**
 * 0hc: не признаваться в кидке/«с лоха», даже если он давит ролевой рамкой.
 */
const path = require('path');
const oh = require(path.join(__dirname, '../services/objectionHandler'));

let fails = 0;
function ok(cond, msg) {
  if (!cond) {
    fails += 1;
    console.error('FAIL', msg);
  } else {
    console.log('OK', msg);
  }
}

const ask =
  'Ну ладно, а сколько получилось максимум вытащить с чувака?) Точнее, с лоха';
ok(oh.isFraudRoleFrame(ask), 'frame: сколько вытащить с лоха');
ok(oh.isFraudRoleFrame('Есть угарные случаи кидка?'), 'frame: угарные случаи кидка');
ok(!oh.isFraudRoleFrame('Есть угарные случаи?'), 'not frame: угарные без кидка');
ok(oh.isFraudRoleFrame('Или почти уголовка)'), 'frame: уголовка');
ok(oh.isFraudRoleFrame('интересно конечно, много развести получается?'), 'frame: много развести');
ok(!oh.isFraudRoleFrame('сколько зарабатываешь?'), 'not frame: ordinary earnings');

const hint = oh.detectHint(ask, []);
ok(hint && /НЕ кидала|не кидаю|мошенниц/i.test(hint), 'detectHint fraud role');

const bad1 = oh.softenFraudAdmissionReply('ну, максимум около 50k рублей', ask, []);
ok(
  bad1 !== 'ну, максимум около 50k рублей' && !/50k|с\s+лоха|вытащ/i.test(bad1),
  `soften 50k → «${bad1}»`,
);

const bad2 = oh.softenFraudAdmissionReply('ахах, ну да, с лоха)', ask, [
  { role: 'user', content: ask },
]);
ok(!/с\s+лоха/i.test(bad2), `soften с лоха → «${bad2}»`);

const keep = oh.softenFraudAdmissionReply('хах ну разное бывает)', 'как дела?', []);
ok(keep === 'хах ну разное бывает)', 'keep normal reply');

if (fails) {
  console.error(`FAIL_COUNT ${fails}`);
  process.exit(1);
}
console.log('SMOKE_FRAUD_ROLE_0HC_OK');
process.exit(0);
