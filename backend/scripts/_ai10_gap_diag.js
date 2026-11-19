require('dotenv').config({ quiet: true });
const db = require('../db');

(async () => {
  const peers = [
    [8, '5241760024'],
    [41, '8671142398'],
  ];
  for (const [acc, peer] of peers) {
    const [msgs] = await db.execute(
      `SELECT id, role, LEFT(content,80) c, created_at
       FROM conversation_messages
       WHERE account_id=? AND peer_id=?
       ORDER BY id DESC LIMIT 6`,
      [acc, peer],
    );
    const [arch] = await db.execute(
      `SELECT 1 FROM archived_peers WHERE account_id=? AND peer_id=? LIMIT 1`,
      [acc, peer],
    );
    const [dis] = await db.execute(
      `SELECT 1 FROM autoreply_disabled_peers WHERE account_id=? AND peer_id=? LIMIT 1`,
      [acc, peer],
    );
    const [olf] = await db.execute(
      `SELECT funnel_stage, note FROM operator_lead_flags WHERE account_id=? AND peer_id=? LIMIT 1`,
      [acc, peer],
    ).catch(() => [[]]);
    console.log('---', `acc${acc}`, peer, 'arch', arch.length, 'dis', dis.length, 'olf', olf[0] || null);
    for (const m of msgs) console.log(m.role, String(m.created_at), JSON.stringify(m.c));
  }

  // deferred busy?
  try {
    const [def] = await db.execute(
      `SELECT account_id, peer_id, fire_at, LEFT(payload,80) p FROM deferred_replies
       WHERE (account_id, peer_id) IN ((8,'5241760024'),(41,'8671142398'))
       ORDER BY id DESC LIMIT 10`,
    ).catch(() => [[]]);
    console.log('DEFERRED', def);
  } catch (e) {
    console.log('no deferred table', e.message);
  }

  const [accs] = await db.execute(
    `SELECT id, is_autoreply_enabled, LEFT(phone,12) phone FROM accounts WHERE id IN (8,41)`,
  );
  console.log('ACCS', accs);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
