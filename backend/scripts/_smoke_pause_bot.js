#!/usr/bin/env node
/**
 * Smoke: pause/unpause autoreply for one real peer (operator_pause).
 * Usage: node scripts/_smoke_pause_bot.js [userId]
 */
require('dotenv').config();
const db = require('../db');
const leadScoring = require('../services/leadScoring');
const { isAutoreplyDisabledForPeer } = require('../services/helpRequestNotifier');

(async () => {
  const userId = Number(process.argv[2] || 24);
  const result = await leadScoring.listScoredConversations(userId, {
    sort: 'score',
    limit: 3,
  });
  const list = result.conversations || result;
  if (!list.length) {
    console.error('no conversations for user', userId);
    process.exit(1);
  }
  const lead = list[0];
  const { account_id: accountId, peer_id: peerId } = lead;
  console.log('target', { userId, accountId, peerId, peer: lead.peer_username });

  const before = await isAutoreplyDisabledForPeer(accountId, peerId);
  console.log('before', before);

  const paused = await leadScoring.setAutoreplyPaused(userId, accountId, peerId, true);
  const mid = await isAutoreplyDisabledForPeer(accountId, peerId);
  console.log('after_pause', paused, 'db', mid);

  const [[row]] = await db.execute(
    `SELECT reason FROM autoreply_disabled_peers WHERE account_id = ? AND peer_id = ? LIMIT 1`,
    [accountId, peerId],
  );
  console.log('row', row);

  const resumed = await leadScoring.setAutoreplyPaused(userId, accountId, peerId, false);
  const after = await isAutoreplyDisabledForPeer(accountId, peerId);
  console.log('after_resume', resumed, 'db', after);

  const ok = mid === true && after === false && row && row.reason === 'operator_pause';
  console.log(ok ? 'PAUSE_OK' : 'PAUSE_FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
