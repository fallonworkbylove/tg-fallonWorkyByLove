#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
SRC=/tmp/0fu

cp -a "$SRC/replyPipeline.js" "$BASE/backend/services/replyPipeline.js"
cp -a "$SRC/churnLearn.js" "$BASE/backend/services/churnLearn.js"
cp -a "$SRC/updates.js" "$BASE/frontend/updates.js"
cp -a "$SRC/index.html" "$BASE/frontend/index.html"
cp -a "$SRC/CHANGELOG_TG.md" "$BASE/CHANGELOG_TG.md"
if [ -d "$BASE/ops-console/app" ]; then
  cp -a "$SRC/updates.js" "$BASE/ops-console/app/updates.js"
fi

# Keep alive PROXY_LIST in process env on restart
cd "$BASE/backend"
eval "$(python3 - <<'PY'
import re
from pathlib import Path
text = Path('.env').read_text(encoding='utf-8', errors='ignore')
keys = [
  'OPENAI_API_KEY', 'ADMIN_CONSOLE_TOKEN', 'PROXY_LIST', 'PROXY_LIST_LOGIN',
  'PROXY_FILE', 'PROXY_FILE_LOGIN', 'BOT_TOKEN', 'PORT',
]
for key in keys:
    m = re.search(rf'^{re.escape(key)}=(.*)$', text, re.M)
    if not m:
        continue
    val = m.group(1).strip()
    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
        val = val[1:-1]
    safe = val.replace("'", "'\"'\"'")
    print(f"export {key}='{safe}'")
PY
)"
echo "inject PROXY_LEN=$(echo "$PROXY_LIST" | tr ';' '\n' | grep -c socks5 || true)"

timeout 90 pm2 restart tgbot --update-env
pm2 save
sleep 8
grep 'Work (DC) пул' /root/.pm2/logs/tgbot-out.log | tail -1
# smoke: no lastIncomingText / churn schema in fresh err
sleep 2
echo '--- fresh err sniff ---'
tail -30 /root/.pm2/logs/tgbot-error.log | grep -E 'lastIncomingText|churnLearn|пул' || echo '(no match in tail — ok)'
echo DEPLOY_0FU_OK
