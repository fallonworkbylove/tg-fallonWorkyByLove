/**
 * Smoke: воронка по дням NFT-кампании (day1–day4).
 */
const path = require('path');
const lead = require(path.join(__dirname, '../services/leadScoring'));

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

assert(Array.isArray(lead.FUNNEL_BOARD_STAGES), 'FUNNEL_BOARD_STAGES');
assert(
  lead.FUNNEL_BOARD_STAGES.join(',') === 'day1,day2,day3,day4',
  'board stages order',
);
assert(lead.FUNNEL_STAGES.includes('filtered'), 'filtered kept for metrics');
assert(lead.FUNNEL_LABELS.day3.includes('NFT'), 'day3 label NFT');
assert(lead.FUNNEL_LABELS.day4.includes('NFT'), 'day4 label NFT');

assert(lead.normalizeFunnelStage('hello') === 'day1', 'legacy hello→day1');
assert(lead.normalizeFunnelStage('chat') === 'day2', 'legacy chat→day2');
assert(lead.normalizeFunnelStage('interest') === 'day3', 'legacy interest→day3');
assert(lead.normalizeFunnelStage('pitch') === 'day4', 'legacy pitch→day4');
assert(lead.normalizeFunnelStage('operator') === 'day4', 'legacy operator→day4');
assert(lead.normalizeFunnelStage('day2') === 'day2', 'day2 passthrough');

assert(lead.dayStageFromAge(3, false) === 'day1', 'age 3h → day1');
assert(lead.dayStageFromAge(30, false) === 'day2', 'age 30h → day2');
assert(lead.dayStageFromAge(50, false) === 'day3', 'age 50h → day3 NFT');
assert(lead.dayStageFromAge(50, true) === 'day4', 'voice → day4');
assert(lead.dayStageFromAge(80, false) === 'day4', 'age 80h → day4');

assert(lead.detectFunnelStage({ age_hours: 10 }, 40).stage === 'day1', 'detect day1');
assert(lead.detectFunnelStage({ age_hours: 55 }, 40).stage === 'day3', 'detect day3');
assert(
  lead.detectFunnelStage({ age_hours: 20, nft_voice_sent: 1 }, 40).stage === 'day4',
  'detect voice day4',
);
assert(
  lead.detectFunnelStage({ pause_reason: 'filtered', age_hours: 10 }, 40).stage === 'filtered',
  'detect filtered',
);
assert(
  lead.detectFunnelStage({ funnel_stage_manual: 'hello', age_hours: 99 }, 40).stage === 'day1',
  'manual legacy maps',
);
assert(
  lead.detectFunnelStage({ funnel_stage_manual: 'day3', age_hours: 1 }, 40).auto === false,
  'manual day3 not auto',
);

console.log('OK funnel_days_0ln');
process.exit(0);
