#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');
const leadScoring = require('../services/leadScoring');

(async () => {
  const [users] = await db.execute(
    'SELECT user_id, COUNT(*) AS c FROM accounts GROUP BY user_id',
  );
  console.log('accounts_by_user', JSON.stringify(users));
  const [peers] = await db.execute(
    `SELECT a.user_id, COUNT(DISTINCT cm.peer_id) AS peers
     FROM conversation_messages cm
     JOIN accounts a ON a.id = cm.account_id
     GROUP BY a.user_id`,
  );
  console.log('peers_by_user', JSON.stringify(peers));
  for (const row of peers) {
    const result = await leadScoring.listScoredConversations(row.user_id, {
      sort: 'funnel',
      limit: 8,
    });
    const list = result.conversations || result;
    console.log('sample_user', row.user_id, 'top', list.length, 'funnel', result.funnel);
    for (const x of list.slice(0, 3)) {
      console.log(
        JSON.stringify({
          peer: x.peer_username || x.peer_id,
          score: x.lead_score,
          tier: x.lead_tier,
          stage: x.funnel_stage,
          hot: x.hot_hits,
          paused: x.autoreply_disabled,
        }),
      );
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
