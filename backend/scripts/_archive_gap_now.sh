#!/bin/bash
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
cp -f /tmp/nftCampaign.js services/nftCampaign.js 2>/dev/null || true
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [gaps] = await db.execute(`
    SELECT cm.account_id, cm.peer_id, LEFT(cm.content,80) c,
           TIMESTAMPDIFF(MINUTE, cm.created_at, NOW()) age_m
    FROM conversation_messages cm
    JOIN accounts a ON a.id = cm.account_id
    WHERE cm.role = 'user'
      AND cm.created_at < NOW() - INTERVAL 20 MINUTE
      AND cm.created_at > NOW() - INTERVAL 6 HOUR
      AND a.is_autoreply_enabled = 1 AND IFNULL(a.prompt, '') != ''
      AND a.session_string IS NOT NULL AND a.session_string != ''
      AND NOT EXISTS (SELECT 1 FROM conversation_messages x WHERE x.account_id=cm.account_id AND x.peer_id=cm.peer_id AND x.role='assistant' AND x.id>cm.id)
      AND NOT EXISTS (SELECT 1 FROM autoreply_disabled_peers ad WHERE ad.account_id=cm.account_id AND ad.peer_id=cm.peer_id)
      AND NOT EXISTS (SELECT 1 FROM archived_peers ap WHERE ap.account_id=cm.account_id AND ap.peer_id=cm.peer_id)
  `);
  console.log('gaps', gaps.length);
  for (const g of gaps) {
    console.log(g.age_m+'m', 'acc'+g.account_id, g.peer_id, g.c);
    await db.execute('INSERT IGNORE INTO archived_peers (account_id, peer_id) VALUES (?, ?)', [g.account_id, g.peer_id]);
  }
  const n = require('./services/nftCampaign');
  const s = n.stripSoftPitchOffer('да, раньше тоже не шарила) могу показать, если интересно, без давления)');
  console.log('strip', s, 'ok', !/могу показать|без давления/i.test(s));
  process.exit(0);
})().catch((e)=>{console.error(e);process.exit(1);});
NODE
