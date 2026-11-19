#!/usr/bin/env node
require('dotenv').config();
const db = require('../db');
const fs = require('fs');

const PHONE = '79324436535';
const PEER = '5484695633';

(async () => {
  const [accs] = await db.execute(
    `SELECT id, phone, status, is_autoreply_enabled, updated_at, created_at
     FROM accounts WHERE phone LIKE ? OR phone LIKE ? ORDER BY id`,
    [`%${PHONE}%`, `%+${PHONE}%`],
  );
  console.log('accounts', accs);

  for (const a of accs) {
    const [pausePeer] = await db.execute(
      `SELECT * FROM autoreply_disabled_peers WHERE account_id = ? AND peer_id = ?`,
      [a.id, PEER],
    ).catch(() => [[]]);
    const [pauseAny] = await db.execute(
      `SELECT COUNT(*) n FROM autoreply_disabled_peers WHERE account_id = ?`,
      [a.id],
    ).catch(() => [[{ n: 0 }]]);
    const [recent] = await db.execute(
      `SELECT role, LEFT(content,80) snip, created_at, peer_username, peer_id
       FROM conversation_messages
       WHERE account_id = ?
       ORDER BY created_at DESC LIMIT 12`,
      [a.id],
    );
    const [bun] = await db.execute(
      `SELECT role, LEFT(content,100) snip, created_at
       FROM conversation_messages
       WHERE account_id = ? AND peer_id = ?
       ORDER BY created_at DESC LIMIT 5`,
      [a.id, PEER],
    );
    console.log(`\n==== account ${a.id} ====`);
    console.log({
      pause_bun187: pausePeer[0] || null,
      pause_peers_total: pauseAny[0]?.n,
    });
    console.log('recent_any', recent);
    console.log('bun187_last', bun);
  }

  // log freeze signals
  const out = fs.readFileSync('/root/.pm2/logs/tgbot-out.log', 'utf8');
  const err = fs.readFileSync('/root/.pm2/logs/tgbot-error.log', 'utf8');
  const chunk = (out + '\n' + err).slice(-3_000_000);
  const lines = chunk.split('\n');
  const hit = lines.filter((l) =>
    /79324436535|Вероника|account 22|Аккаунт 22|account_id.: 22|\[22\b/i.test(l) &&
    /FROZEN|мороз|freeze|PEER_ID_INVALID|AI не дал|пауза|архив|не отвечаю|Ответ для|Catch-up|Authorization|FLOOD|banned/i.test(l),
  );
  console.log('\n==== log hits (filtered) ====');
  console.log(hit.slice(-40).join('\n') || '(none)');

  const frozen = lines.filter((l) => /FROZEN|мороз/i.test(l) && /79324436535|Вероника|Аккаунт 22|798.*Верон/i.test(l));
  console.log('\n==== freeze lines for this phone ====');
  console.log(frozen.slice(-20).join('\n') || '(none specific)');

  const frozen22 = lines.filter((l) => /FROZEN/i.test(l) && /Аккаунт 22|79324436535 — Вероника/i.test(l));
  console.log('\n==== FROZEN + acc22/veronika ====');
  console.log(frozen22.slice(-15).join('\n') || '(none)');

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
