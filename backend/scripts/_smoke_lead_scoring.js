#!/usr/bin/env node
require('dotenv').config();
const leadScoring = require('../services/leadScoring');

async function main() {
  const userId = Number(process.argv[2] || 24);
  const result = await leadScoring.listScoredConversations(userId, {
    sort: 'funnel',
    limit: 8,
  });
  const list = result.conversations || [];
  console.log('count', list.length);
  console.log('funnel', result.funnel);
  for (const x of list.slice(0, 5)) {
    console.log(
      JSON.stringify({
        peer: x.peer_username || x.peer_id,
        score: x.lead_score,
        tier: x.lead_tier,
        stage: x.funnel_stage,
        auto: x.funnel_auto,
        paused: x.autoreply_disabled,
        focus: x.operator_focus,
        msgs: x.message_count,
      }),
    );
  }
  console.log(list.length ? 'FUNNEL_OK' : 'FUNNEL_EMPTY');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAIL', e.message);
    process.exit(1);
  });
