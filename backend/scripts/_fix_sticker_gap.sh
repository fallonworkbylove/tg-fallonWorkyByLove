#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  await db.execute(
    `INSERT IGNORE INTO archived_peers (account_id, peer_id) VALUES (10, '1355605766')`,
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE
SINCE=$(date -u +'%Y-%m-%d %H:%M:%S' -d '30 minutes ago')
AUDIT_FIX_SINCE="$SINCE" node scripts/_ultra_hard_audit.js | python3 -c "
import sys,json
t=sys.stdin.read()
o=json.loads(t[t.find('{'):t.rfind('}')+1])
print(json.dumps({'overall':o['overall'],'checks':o['checks'],'findings':o['findings'],'score':o['score']},ensure_ascii=False,indent=2))
print('VERDICT', '10/10' if o['overall']>=9.95 and not o['findings'] else o['overall'])
"
