/**
 * Smoke 0hk: media ask during account-sleep still allowed in pipeline + silence heal.
 */
const fs = require('fs');
const path = require('path');
const assert = (c, m) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('OK', m);
};

const pipe = fs.readFileSync(path.join(__dirname, '../services/replyPipeline.js'), 'utf8');
const sc = fs.readFileSync(path.join(__dirname, '../services/silenceCatchup.js'), 'utf8');

assert(/медиа-просьба во сне/.test(pipe), 'pipeline logs media-while-sleep');
assert(/!isWithinWorkingHours\(accountId\) && !mediaWhileSleep/.test(pipe) || /!isWithinWorkingHours\(accountId\) && !isHardMediaRequest/.test(pipe), 'sleep gate allows hard media');
assert(/timeInfo\.isSleep && !isHardMediaRequest/.test(pipe), 'isSleep bypass for media');
assert(/!isWithinWorkingHours\(accountId\) && !mediaSeedEarly/.test(sc), 'silence heal allows media outside work hours');
assert(/isNightTextQuietHour\(\)\) return false/.test(sc) || /if \(isNightTextQuietHour\(\)\) return false/.test(sc), 'night quiet still blocks heal');

const { isHardMediaRequest } = require('../services/mediaSend');
assert(isHardMediaRequest('Можешь видео записать лайф'), 'лайф is hard media');
assert(isHardMediaRequest('Запиши кружок пожалуйста'), 'кружок is hard media');
assert(!isHardMediaRequest('Ага )'), 'ack is not hard media');

console.log(process.exitCode ? 'SMOKE_FAIL' : 'SMOKE_OK');
process.exit(process.exitCode || 0);
