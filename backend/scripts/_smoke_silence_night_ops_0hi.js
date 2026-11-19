/**
 * Smoke 0hi: night quiet text + silence catchup module + ops bridge no bake.
 */
const fs = require('fs');
const path = require('path');

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('OK', msg);
  }
};

const timingSrc = fs.readFileSync(path.join(__dirname, '../services/timing.js'), 'utf8');
assert(/function isNightTextQuietHour/.test(timingSrc), 'isNightTextQuietHour defined');
assert(/isNightTextQuietHour,\s*\n\s*sleep/.test(timingSrc) || /isNightTextQuietHour,/.test(timingSrc), 'night quiet exported');

const silenceSrc = fs.readFileSync(path.join(__dirname, '../services/silenceCatchup.js'), 'utf8');
assert(/runSilenceCatchupHeal/.test(silenceSrc), 'runSilenceCatchupHeal');
assert(/findDbSilenceGaps/.test(silenceSrc), 'findDbSilenceGaps');
assert(/silence-heal/.test(silenceSrc), 'silence-heal log tag');

const pipe = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
assert(/isNightTextQuietHour\(\)/.test(pipe), 'pipeline gates night text');

const oq = fs.readFileSync(path.join(__dirname, '../services/opsQuality.js'), 'utf8');
assert(/runSilenceCatchupHeal/.test(oq), 'opsQuality wires silence heal');

const tc = fs.readFileSync(path.join(__dirname, '../services/telegramClient.js'), 'utf8');
assert(/configureSilenceCatchup/.test(tc), 'telegramClient wires silence catchup');

const bridge = fs.readFileSync(
  path.join(__dirname, '../../ops-console/app/ops-web-bridge.js'),
  'utf8',
);
assert(/ops-loverussian\.duckdns\.org/.test(bridge), 'bridge knows ops origin');
assert(!/saveStore\(\{ token, baseUrl/.test(bridge), 'bridge does not bake android token');

const javaPath = path.join(
  __dirname,
  '../../ops-android/app/src/main/java/org/loverussian/ops/OpsJsBridge.java',
);
if (fs.existsSync(javaPath)) {
  const java = fs.readFileSync(javaPath, 'utf8');
  assert(/return false;/.test(java), 'APK hasBootstrap false');
  assert(/return "";/.test(java), 'APK token empty');
  const main = fs.readFileSync(
    path.join(__dirname, '../../ops-android/app/src/main/java/org/loverussian/ops/MainActivity.java'),
    'utf8',
  );
  assert(/loverussian\.duckdns\.org/.test(main), 'APK opens ops URL');
} else {
  console.log('SKIP android sources (not on VPS tree)');
}

console.log(process.exitCode ? 'SMOKE_FAIL' : 'SMOKE_OK');
process.exit(process.exitCode || 0);
