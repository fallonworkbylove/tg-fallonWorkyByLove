#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cp -f /tmp/0lx/opsQuality.js "$BASE/backend/services/opsQuality.js"
cp -f /tmp/0lx/silenceCatchup.js "$BASE/backend/services/silenceCatchup.js"
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
pm2 restart tgbot --update-env
pm2 save
sleep 10
bash "$BASE/backend/scripts/_deploy_guard.sh"
# recount with new filter
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
       AND TRIM(t.last_user_text) NOT REGEXP '^(понятно|понял|ок|окей|ладно|угу|ага|ясно|ну[[:space:]]+ок)([.!?…)]|[[:space:]])*$'
       AND t.last_user_text NOT REGEXP '(ты[[:space:]]+(бот|ии|нейро)|привет[,.[:space:]]*ии|боты?[[:space:]]+заеб|это[[:space:]]+бот)'
       AND t.last_user_text NOT REGEXP '^(бери[[:space:]]+трубку|подними[[:space:]]+трубку|возьми[[:space:]]+трубку|позвони|набери|дай[[:space:]]+номер|скинь[[:space:]]+номер)'
       AND t.last_user_text NOT REGEXP '(^|[[:space:][:punct:]]+)(пока|ппк)([.!?…)]|[[:space:]])*$'
       AND t.last_user_text NOT REGEXP '^(спокойной[[:space:]]+ночи|до[[:space:]]+завтра|я[[:space:]]+спать)([.!?…)]|[[:space:]])*$'
  `);
  console.log('waiting_after_soft_filter', Number(rows[0].c));
  const [detail] = await db.query(`
    SELECT c.account_id,
           (SELECT MAX(cm.peer_username) FROM conversation_messages cm
             WHERE cm.account_id=c.account_id AND cm.peer_id=c.peer_id) AS uname,
           TIMESTAMPDIFF(MINUTE, c.last_user_at, NOW()) AS wait_min,
           (SELECT LEFT(u.content,70) FROM conversation_messages u
             WHERE u.account_id=c.account_id AND u.peer_id=c.peer_id AND u.role='user'
             ORDER BY u.id DESC LIMIT 1) AS t
    FROM (
      SELECT account_id, peer_id, MAX(created_at) AS last_user_at
      FROM conversation_messages
      WHERE role='user' AND created_at >= (NOW() - INTERVAL 6 HOUR)
        AND created_at <= (NOW() - INTERVAL 10 MINUTE)
      GROUP BY account_id, peer_id
    ) c
    JOIN accounts a ON a.id=c.account_id AND a.is_autoreply_enabled=1
    LEFT JOIN autoreply_disabled_peers ad ON ad.account_id=c.account_id AND ad.peer_id=c.peer_id
    LEFT JOIN archived_peers ap ON ap.account_id=c.account_id AND ap.peer_id=c.peer_id
    WHERE ap.peer_id IS NULL AND ad.id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM conversation_messages b
        WHERE b.account_id=c.account_id AND b.peer_id=c.peer_id
          AND b.role='assistant' AND b.created_at >= c.last_user_at
      )
    ORDER BY wait_min DESC LIMIT 10
  `);
  for (const r of detail) {
    console.log(JSON.stringify({
      acc: r.account_id,
      peer: r.uname,
      wait_min: r.wait_min,
      t: String(r.t||'').replace(/\s+/g,' ').slice(0,60),
    }));
  }
  process.exit(0);
})().catch((e)=>{console.error(e);process.exit(1);});
NODE
echo HOT_SOFT_CLOSE_OK
