#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cp -f /tmp/0lw/opsQuality.js "$BASE/backend/services/opsQuality.js"
cp -f /tmp/0lw/silenceCatchup.js "$BASE/backend/services/silenceCatchup.js"
cp -f /tmp/0lw/_smoke_waiting_filter_0lw.js "$BASE/backend/scripts/_smoke_waiting_filter_0lw.js"
(
  export OPENAI_API_KEY=sk-deploy
  node "$BASE/backend/scripts/_smoke_waiting_filter_0lw.js"
)
eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text = Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/.env').read_text(encoding='utf-8', errors='ignore')
for key in ['OPENAI_API_KEY', 'PROXY_LIST', 'OPENAI_PROXY_LIST']:
    m = re.search(rf'^{re.escape(key)}=(.*)$', text, re.M)
    if m:
        print('export %s=%s' % (key, shlex.quote(m.group(1).strip())))
PY
)"
unset AUDIT_SMOKE || true
case "${OPENAI_API_KEY:-}" in
  ''|sk-deploy*|sk-audit*|sk-test*) echo REFUSE_OPENAI_FAKE; exit 1;;
esac
pm2 restart tgbot --update-env
pm2 save
sleep 15
bash "$BASE/backend/scripts/_deploy_guard.sh"
sleep 100
echo "--- heal ---"
grep -aE 'silence-heal|healed |очереди/Занята' /root/.pm2/logs/tgbot-out.log | tail -20
bash "$BASE/backend/scripts/_cleanup_busy_heal_0lw.sh" || true
cd "$BASE/backend" && node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [rows] = await db.query(`
    SELECT COUNT(*) AS c FROM (
       SELECT c.account_id, c.peer_id,
              (SELECT LEFT(u.content, 120) FROM conversation_messages u
                WHERE u.account_id = c.account_id AND u.peer_id = c.peer_id
                  AND u.role = 'user' ORDER BY u.id DESC LIMIT 1) AS last_user_text
       FROM (
         SELECT account_id, peer_id, MAX(created_at) AS last_user_at
         FROM conversation_messages
         WHERE role = 'user'
           AND created_at >= (NOW() - INTERVAL 6 HOUR)
           AND created_at <= (NOW() - INTERVAL 10 MINUTE)
         GROUP BY account_id, peer_id
       ) c
       JOIN accounts a ON a.id = c.account_id AND a.is_autoreply_enabled = 1
       LEFT JOIN autoreply_disabled_peers ad ON ad.account_id = c.account_id AND ad.peer_id = c.peer_id
       LEFT JOIN archived_peers ap ON ap.account_id = c.account_id AND ap.peer_id = c.peer_id
       LEFT JOIN operator_lead_flags olf ON olf.account_id = c.account_id AND olf.peer_id = c.peer_id
       WHERE ap.peer_id IS NULL AND ad.id IS NULL
         AND (olf.funnel_stage IS NULL OR olf.funnel_stage <> 'filtered')
         AND NOT EXISTS (
           SELECT 1 FROM conversation_messages b
           WHERE b.account_id = c.account_id AND b.peer_id = c.peer_id
             AND b.role = 'assistant' AND b.created_at >= c.last_user_at
         )
     ) t
     WHERE TRIM(IFNULL(t.last_user_text, '')) <> ''
       AND TRIM(t.last_user_text) NOT REGEXP '^[.!?…]+$'
       AND t.last_user_text NOT REGEXP '^(бери[[:space:]]+трубку|подними[[:space:]]+трубку|возьми[[:space:]]+трубку|позвони|набери|дай[[:space:]]+номер|скинь[[:space:]]+номер)'
       AND t.last_user_text NOT REGEXP '(^|[[:space:][:punct:]]+)(пока|ппк)([.!?…)]|[[:space:]])*$'
       AND t.last_user_text NOT REGEXP '^(спокойной[[:space:]]+ночи|до[[:space:]]+завтра|я[[:space:]]+спать)([.!?…)]|[[:space:]])*$'
  `);
  console.log('waiting_filtered_final', Number(rows[0].c));
  process.exit(0);
})().catch((e)=>{console.error(e);process.exit(1);});
NODE
echo HOT_0lw_OK
