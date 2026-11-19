#!/usr/bin/env node
/**
 * Live Telegram archive check for @bun187 on accounts 22 and 26.
 */
require('dotenv').config();
const { getActiveClient, accountLabel } = require('../services/clientPool');
const { isPeerArchived } = require('../services/peers');

async function check(accountId, peerId) {
  const client = getActiveClient(accountId);
  if (!client) {
    console.log({ accountId, live: false, reason: 'no_active_client' });
    return;
  }
  try {
    const entity = await client.getEntity(Number(peerId));
    const archived = await isPeerArchived(client, entity);
    const username = entity.username || null;
    const name = [entity.firstName, entity.lastName].filter(Boolean).join(' ') || null;
    console.log({
      accountId,
      label: accountLabel(accountId),
      live: true,
      username,
      name,
      peerId,
      telegram_archived: archived,
    });
  } catch (e) {
    console.log({
      accountId,
      live: true,
      peerId,
      error: e.errorMessage || e.message,
    });
  }
}

(async () => {
  const peerId = '5484695633';
  await check(22, peerId);
  await check(26, peerId);
  // also blacklist
  const db = require('../db');
  const [bl] = await db.execute(
    `SELECT * FROM blacklist WHERE peer_id = ? OR username LIKE ? LIMIT 10`,
    [peerId, '%bun187%'],
  ).catch(() => [[]]);
  console.log('blacklist', bl);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
