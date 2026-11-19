#!/bin/bash
python3 <<'PY'
import json
from pathlib import Path
d=json.loads(Path('/tmp/mega_deep.json').read_text())
fails=[c for c in d['checks'] if not c['pass']]
print('DEEP', d['pass'], '/', d['total'])
print('FAILS', json.dumps(fails, ensure_ascii=False))
print('ACCOUNTS', json.dumps(d['accounts'], ensure_ascii=False))
print('BAD24', d['bad_24h'])
print('NFT', json.dumps(d['nft_schedule'], ensure_ascii=False))
print('FLIP7D', d['flip_mentions_7d'])
print('VOL24', json.dumps(d['vol_24h'], ensure_ascii=False))
PY
echo '---LOG---'
grep -E 'overall|VERDICT|HUMAN|tick|MEGA_DONE|FAIL|P0' /tmp/mega_audit_run.log | tail -50
echo '---WATCH---'
tail -20 /tmp/mega_watch.tsv 2>/dev/null || true
echo '---BAD24 SAMPLE---'
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [r] = await db.execute(`SELECT account_id, content, created_at FROM conversation_messages
    WHERE role='assistant' AND created_at > NOW()-INTERVAL 24 HOUR
      AND (TRIM(content) IN ('а ещё)','ага)','ну да)','хм ок)','да-да я слушаю)')
           OR content LIKE '%[отправила %'
           OR content LIKE '%чем могу помочь%'
           OR content REGEXP 'могу показать.{0,40}без давления')
    ORDER BY id DESC LIMIT 10`);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e)=>{console.error(e);process.exit(1);});
NODE
pgrep -af mega_audit | head -3
