#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cp -f /tmp/0lx/silenceCatchup.js "$BASE/backend/services/silenceCatchup.js"
cp -f /tmp/0lx/telegramClient.js "$BASE/backend/services/telegramClient.js"
cp -f /tmp/0lx/_smoke_waiting_night_0lx.js "$BASE/backend/scripts/_smoke_waiting_night_0lx.js"
(
  export OPENAI_API_KEY=sk-deploy
  node "$BASE/backend/scripts/_smoke_waiting_night_0lx.js"
)
# clear busy so reengage doesn't block
cd "$BASE/backend"
node <<'NODE'
require('dotenv').config({ quiet: true });
const db = require('./db');
(async () => {
  const [d] = await db.execute(
    `DELETE FROM busy_deferred WHERE account_id IN (41,42,52,54)`,
  );
  console.log('busy_cleared_acc', d.affectedRows || 0);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
NODE

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
sleep 15
bash "$BASE/backend/scripts/_deploy_guard.sh"
sleep 100
echo "--- heal ---"
grep -aE 'silence-heal:|sync TG|очереди/Занята|healed ' /root/.pm2/logs/tgbot-out.log | tail -30
cd "$BASE/backend" && node scripts/_peek_waiting_peers_0lx.js || true
bash /tmp/fw.sh 2>/dev/null || true
echo HOT_0lx_SYNC_OK
