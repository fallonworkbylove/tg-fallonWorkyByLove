#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

node <<'NODE'
require('dotenv').config({ quiet: true });
const ef = require('./services/externalFacts');
const pp = require('./services/peerProfile');
const ls = require('./services/leadScoring');
console.log('exports', typeof ef.buildExternalFactHint, typeof pp.buildHint, typeof ls.getPeerScoreSnapshot);
(async () => {
  const btc = await ef.buildExternalFactHint('живу в Москве', 'какой курс биткоина?');
  console.log('btc_hint', String(btc || '').slice(0, 140));
  const time = await ef.buildExternalFactHint('живу в Казани', 'который час?');
  console.log('time_hint', String(time || '').slice(0, 140));

  const db = require('./db');
  const [rows] = await db.execute(
    'SELECT account_id, peer_id FROM conversation_messages ORDER BY id DESC LIMIT 1',
  );
  if (!rows[0]) {
    console.log('export_skip no_messages');
    process.exit(0);
  }
  const aid = rows[0].account_id;
  const pid = rows[0].peer_id;
  const key = process.env.TELEGRAM_AUTH_BYPASS_KEY || '';
  const url = `http://127.0.0.1:3000/api/accounts/conversations/${aid}/${encodeURIComponent(pid)}/export`;
  const res = await fetch(url, { headers: { 'X-Auth-Bypass-Key': key } });
  const text = await res.text();
  console.log('export_status', res.status);
  console.log('export_snip', text.slice(0, 280).replace(/\n/g, ' | '));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE

pm2 logs tgbot --err --lines 40 --nostream 2>/dev/null \
  | grep -E 'ReferenceError|Cannot find|is not defined|SyntaxError' \
  | tail -10 || true
echo '---'
grep -n 'app.js?v=' /root/opt/tgbot/tg-miniapp-loverussian/frontend/index.html || true
echo smoke_0du_ok
