/**
 * Ping every account that has a session_string — not only the bypass user's list.
 */
require('dotenv').config();
const db = require('../db');
const { isActive, pingActiveSession, accountLabel } = require('../services/telegramClient');

(async () => {
  // Give bootstrap a moment if just required cold — usually pool already warm in pm2.
  // This script runs in a SEPARATE process so isActive will be empty!
  // Use HTTP session-ping against the live pm2 process instead.
  const key = String(process.env.TELEGRAM_AUTH_BYPASS_KEY || '').trim();
  const h = key ? { 'X-Auth-Bypass-Key': key } : {};

  const [rows] = await db.execute(
    `SELECT id, phone, status, is_autoreply_enabled,
            CASE WHEN session_string IS NULL OR session_string = '' THEN 0 ELSE 1 END AS has_session
     FROM accounts
     ORDER BY id`,
  );

  console.log('db_accounts', rows.length);
  let withSession = 0;
  let pingOk = 0;
  let pingOffline = 0;
  let pingOther = 0;

  for (const r of rows) {
    if (!r.has_session) {
      console.log(`id=${r.id} | ${r.phone} | no_session | status=${r.status}`);
      continue;
    }
    withSession += 1;
    const res = await fetch(`http://127.0.0.1:3000/api/accounts/${r.id}/session-ping`, {
      headers: h,
    });
    const text = await res.text();
    let line;
    try {
      const p = JSON.parse(text);
      if (p.ok) {
        pingOk += 1;
        line = `ping=ok | ${p.phone || ''} @${p.username || ''} ${p.firstName || ''}`.trim();
      } else {
        if (p.reason === 'offline') pingOffline += 1;
        else pingOther += 1;
        line = `ping=FAIL | ${p.reason || text.slice(0, 80)}`;
      }
    } catch (_) {
      pingOther += 1;
      line = `ping=BAD_HTTP ${res.status} ${text.slice(0, 80)}`;
    }
    console.log(
      `id=${r.id} | ${r.phone} | status=${r.status} | ai=${r.is_autoreply_enabled} | ${line}`,
    );
  }

  console.log('summary', { withSession, pingOk, pingOffline, pingOther });
  // offline may be other users' accounts not bootstrapped for this process owner — exit 0 if all withSession that are AI-on are ok
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
