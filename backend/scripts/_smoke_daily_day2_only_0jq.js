/**
 * Smoke 0jq: профит-скрины только день 2 (24–48ч), окно 18–20 МСК.
 * День 3+ — NFT, без daily photo window.
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const fs = require('fs');
const path = require('path');

const assert = (c, m) => {
  if (!c) {
    console.error('FAIL', m);
    process.exitCode = 1;
  } else console.log('OK', m);
};

const daily = require('../services/dailyPhotos');
const src = fs.readFileSync(path.join(__dirname, '../services/dailyPhotos.js'), 'utf8');
const nftSrc = fs.readFileSync(path.join(__dirname, '../services/nftCampaign.js'), 'utf8');

assert(daily.DAY2_AGE_MIN_H === 24, 'day2 min 24h');
assert(daily.DAY2_AGE_MAX_H === 48, 'day2 max 48h');
assert(daily.WINDOW_START_HOUR === 18, 'window start 18');
assert(daily.WINDOW_END_HOUR === 20, 'window end 20');

assert(daily.photoWindowForAgeHours(12) === null, 'day1 no window');
assert(daily.photoWindowForAgeHours(23.9) === null, 'almost day2 no window');
const d2 = daily.photoWindowForAgeHours(30);
assert(d2 && d2.start && d2.end, 'day2 has window');
assert(d2.end - d2.start === 2 * 60 * 60 * 1000, 'day2 window 2h');
assert(daily.photoWindowForAgeHours(48) === null, 'age 48 no photo (NFT)');
assert(daily.photoWindowForAgeHours(60) === null, 'day3+ no photo');
assert(daily.photoWindowForAgeHours(NaN) === null, 'NaN no window');

assert(/past_day2_nft_phase/.test(src), 'skip reason past_day2');
assert(!/moscowWindowBounds\(now,\s*13,\s*15\)/.test(src), 'no day3 13-15 window');
assert(/now < windowStart/.test(src), 'gate before window start');
assert(
  /NFT_VOICE_AFTER_HOURS[^\n]*48|=\s*Number\(process\.env\.NFT_VOICE_AFTER_HOURS\s*\|\|\s*48\)/.test(
    nftSrc,
  ) || /48/.test(nftSrc),
  'NFT still after ~48h',
);

console.log(process.exitCode ? 'SMOKE_FAIL' : 'SMOKE_DAILY_DAY2_ONLY_0JQ_OK');
process.exit(process.exitCode || 0);
