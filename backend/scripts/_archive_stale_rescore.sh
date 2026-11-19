#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend

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
      AND NOT EXISTS (
        SELECT 1 FROM conversation_messages x
        WHERE x.account_id = cm.account_id AND x.peer_id = cm.peer_id
          AND x.role = 'assistant' AND x.id > cm.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM autoreply_disabled_peers ad
        WHERE ad.account_id = cm.account_id AND ad.peer_id = cm.peer_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM archived_peers ap
        WHERE ap.account_id = cm.account_id AND ap.peer_id = cm.peer_id
      )
  `);
  console.log('stale_before', gaps.length);
  for (const g of gaps) {
    console.log(g.age_m + 'm', 'acc' + g.account_id, g.peer_id, g.c);
    await db.execute(
      'INSERT IGNORE INTO archived_peers (account_id, peer_id) VALUES (?, ?)',
      [g.account_id, g.peer_id],
    );
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE

echo '=== A ==='
AUDIT_FIX_SINCE='2026-10-27 15:52:00' node scripts/_ultra_hard_audit.js > /tmp/ultra_a.txt
grep -E 'overall|VERDICT|P0_COUNT|CHECKS|"findings"|assistant_since|short_1_8|mid_9|long_40|ai_on|ai_with|pass.:|total' /tmp/ultra_a.txt | head -40
python3 - <<'PY'
import json,re
t=open('/tmp/ultra_a.txt').read()
i=t.find('{')
j=t.rfind('}')
obj=json.loads(t[i:j+1])
open('/tmp/ultra_report.json','w').write(json.dumps(obj,ensure_ascii=False,indent=2))
print('saved report')
print('overall', obj['overall'])
print('findings', obj['findings'])
print('checks', obj['checks'])
print('score', obj['score'])
PY

echo '=== B ==='
AUDIT_FIX_SINCE='2026-10-27 15:52:00' node scripts/_ultra_hard_audit.js | grep -E 'overall|VERDICT|P0_COUNT|CHECKS|findings.:'
echo ARCHIVE_RESCORE_DONE
