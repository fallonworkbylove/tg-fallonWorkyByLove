/**
 * Debug + force-process one silence gap peer via silenceCatchup internals.
 */
require('dotenv').config({ quiet: true });
const db = require('../db');
const { getActiveClient, accountLabel } = require('../services/clientPool');

(async () => {
  const targets = [
    { accountId: 8, peerId: '5241760024' },
    { accountId: 41, peerId: '8671142398' },
  ];
  for (const t of targets) {
    const client = getActiveClient(t.accountId);
    console.log(
      'CLIENT',
      accountLabel(t.accountId),
      !!client,
      client ? typeof client.connected : null,
      client?.connected,
    );
  }

  // pending deferred from scaleOps / busy
  try {
    const [rows] = await db.execute(
      `SHOW TABLES LIKE 'deferred%'`,
    );
    console.log('deferred_tables', rows);
  } catch (_) {}

  try {
    const [busy] = await db.execute(
      `SELECT * FROM text_promises WHERE account_id IN (8,41) ORDER BY id DESC LIMIT 10`,
    ).catch(() => [[]]);
    console.log('text_promises', busy);
  } catch (e) {
    console.log('tp', e.message);
  }

  // Check scaleOps deferred store
  try {
    const so = require('../services/scaleOps');
    if (typeof so.listDeferred === 'function') {
      console.log('scale deferred', so.listDeferred());
    }
  } catch (e) {
    console.log('scaleOps', e.message);
  }

  // Try heal again with verbose by requiring and calling find + healOne
  const silence = require('../services/silenceCatchup');
  const gaps = await silence.findDbSilenceGaps({ maxAgeHours: 12, minAgeMin: 1, limit: 20 });
  const hit = gaps.filter((g) =>
    (Number(g.account_id) === 8 && String(g.peer_id) === '5241760024') ||
    (Number(g.account_id) === 41 && String(g.peer_id) === '8671142398'),
  );
  console.log('GAP_HIT', hit.map((g) => ({ a: g.account_id, p: g.peer_id, t: g.last_user_text, at: g.last_user_at })));

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
