/**
 * Smoke 0hj: entity resolve helpers + soft media gaps + wider anti-stub + nightly title.
 */
const fs = require('fs');
const path = require('path');
const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else console.log('OK', msg);
};

const sc = require('../services/silenceCatchup');
const hh = require('../services/humanHardening');

assert(typeof sc.resolvePeerEntity === 'function', 'resolvePeerEntity exported');
assert(typeof sc.findUnfulfilledMediaGaps === 'function', 'findUnfulfilledMediaGaps exported');
assert(/listUserDialogs/.test(fs.readFileSync(path.join(__dirname, '../services/silenceCatchup.js'), 'utf8')), 'uses listUserDialogs');
assert(/mediaSoftNeed|findUnfulfilledMediaGaps/.test(fs.readFileSync(path.join(__dirname, '../services/silenceCatchup.js'), 'utf8')), 'soft media heal wired');

// anti-stub wider
{
  const out = hh.expandBareStubOnQuestion('поняла)', 'Любишь домашних животных?');
  assert(out !== 'поняла)', 'question stub expanded: ' + out);
}
{
  const out = hh.expandBareStubOnQuestion(
    'ок)',
    'Без дела сидит только мой кот. Он живет лучшую жизнь и кушает рыбку каждый день',
  );
  assert(out !== 'ок)', 'long statement stub expanded: ' + out);
}
{
  const out = hh.expandBareStubOnQuestion('поняла)', '[Голосовое]: Ну, в общем, в целом, неплохо.');
  assert(out !== 'поняла)', 'voice stub expanded: ' + out);
}
{
  const keep = hh.expandBareStubOnQuestion('ок)', 'ага');
  assert(keep === 'ок)', 'bare ack user keeps stub');
}
{
  const out = hh.expandBareStubOnQuestion('поняла)', 'Можешь видео записать лайф');
  assert(/позже|неудоб|занята|не могу/i.test(out), 'media stub defer: ' + out);
}

// hard_audit title regex updated
{
  const hard = fs.readFileSync(path.join(__dirname, '_hard_audit_0gc.js'), 'utf8');
  assert(/Ночью не пишет|догоняет/.test(hard), 'hard_audit accepts current updates titles');
}

// APK no-bake + ops origin (sources may be absent on VPS tree)
{
  const mainPath = path.join(
    __dirname,
    '../../ops-android/app/src/main/java/org/loverussian/ops/MainActivity.java',
  );
  const bridgePath = path.join(
    __dirname,
    '../../ops-android/app/src/main/java/org/loverussian/ops/OpsJsBridge.java',
  );
  if (!fs.existsSync(mainPath) || !fs.existsSync(bridgePath)) {
    console.log('SKIP android sources (not on VPS tree)');
  } else {
    const main = fs.readFileSync(mainPath, 'utf8');
    const bridge = fs.readFileSync(bridgePath, 'utf8');
    assert(
      /ops-loverussian\.duckdns\.org|loverussian\.duckdns\.org\/ops/.test(main),
      'APK OPS_URL set',
    );
    assert(/return ""/.test(bridge) || /return "";/.test(bridge), 'bridge token empty');
  }
}

console.log(process.exitCode ? 'SMOKE_FAIL' : 'SMOKE_OK');
process.exit(process.exitCode || 0);
