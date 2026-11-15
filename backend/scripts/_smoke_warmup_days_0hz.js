/**
 * Smoke 0hz: 3-day warmup lives in code, not in persona prompt.
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

const nft = require('../services/nftCampaign');
const job = require('../services/jobFlipAsk');
const so = require('../services/scaleOps');
const dailySrc = fs.readFileSync(path.join(__dirname, '../services/dailyPhotos.js'), 'utf8');
const nftSrc = fs.readFileSync(path.join(__dirname, '../services/nftCampaign.js'), 'utf8');

assert(typeof nft.warmupDay1Hint === 'function' || /warmupDay1Hint|ПЛАН ДНЯ 1/.test(nftSrc), 'day1 hint in nftCampaign');
assert(/ПЛАН ДНЯ 1/.test(nftSrc) && /ПЛАН ДНЯ 2/.test(nftSrc) && /ПЛАН ДНЯ 3/.test(nftSrc), 'day1/2/3 plans in code');
assert(/photoWindowForAgeHours/.test(dailySrc), 'photo windows by age');
// 0jq: только день 2 (18–20), день 3+ без профит-скринов (NFT)
assert(/DAY2_AGE_MAX_H\s*=\s*48/.test(dailySrc) && /past_day2_nft_phase/.test(dailySrc), 'day2-only photos');
assert(!/moscowWindowBounds\(now,\s*13,\s*15\)/.test(dailySrc), 'no day3 photo window');

const soft = job.softJobHint();
assert(/флипинг|подрабатываю в интернете/i.test(soft), 'day1 job allows flip/internet');
assert(!/ЗАПРЕЩЕНО:.*флип/i.test(soft), 'day1 does not ban flip word');

assert(
  so.PERSONA_TEMPLATES.every((t) => !/ДЕНЬ 1|ДЕНЬ 2|ДЕНЬ 3|3-дневн/i.test(t.template || '')),
  'slim template has no day plan',
);
assert(
  so.PERSONA_TEMPLATES.every((t) => !/ДЕНЬ 1 — Знакомство/i.test(t.prompt || '')),
  'filled prompt has no day block',
);

console.log(process.exitCode ? 'SMOKE_FAIL' : 'SMOKE_WARMUP_DAYS_0HZ_OK');
process.exit(process.exitCode || 0);
