#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo "=== logs bardak / 0:01 voice ==="
grep -aE 'bardak0528|bardak' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | tail -40 || true
echo
echo "=== outbound voice today ==="
grep -aE 'outbound voice peer=bardak|голосовое|voice peer=bardak|voprosy|sendVoice|Заготовка' /root/.pm2/logs/tgbot-out*.log 2>/dev/null | grep -i bardak | tail -20 || true
echo
echo "=== DB messages ==="
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text=Path('.env').read_text(encoding='utf-8',errors='ignore')
for key in ['OPENAI_API_KEY','DB_HOST','DB_USER','DB_PASSWORD','DB_NAME','MYSQL_HOST','MYSQL_USER','MYSQL_PASSWORD','MYSQL_DATABASE']:
    m=re.search(rf'^{re.escape(key)}=(.*)$',text,re.M)
    if not m: continue
    print('export %s=%s'%(key, shlex.quote(m.group(1).strip())))
PY
)"
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [peers] = await db.execute(
    `SELECT account_id, peer_id, peer_username, LEFT(content,120) c, role, created_at
     FROM conversation_messages
     WHERE peer_username LIKE '%bardak%' OR content LIKE '%bardak%'
        OR peer_id IN (
          SELECT peer_id FROM conversation_messages
          WHERE peer_username LIKE '%bardak%' LIMIT 5
        )
     ORDER BY id DESC LIMIT 5`
  ).catch(() => [[]]);
  const [rows] = await db.execute(
    `SELECT cm.account_id, cm.peer_id, cm.peer_username, cm.role,
            LEFT(cm.content,160) content, cm.created_at, a.label, a.phone
     FROM conversation_messages cm
     LEFT JOIN accounts a ON a.id = cm.account_id
     WHERE cm.peer_username LIKE '%bardak%'
        OR cm.peer_id LIKE '%bardak%'
     ORDER BY cm.id DESC LIMIT 30`
  );
  if (!rows.length) {
    const [rows2] = await db.execute(
      `SELECT cm.account_id, cm.peer_id, cm.peer_username, cm.role,
              LEFT(cm.content,160) content, cm.created_at
       FROM conversation_messages cm
       WHERE cm.content LIKE '%[голосовое:%'
         AND cm.created_at > NOW() - INTERVAL 2 DAY
         AND cm.role='assistant'
       ORDER BY cm.id DESC LIMIT 40`
    );
    console.log('no bardak username match; recent voices sample', rows2.length);
    console.log(JSON.stringify(rows2.slice(0,15), null, 2));
  } else {
    console.log(JSON.stringify(rows, null, 2));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE
