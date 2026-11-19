#!/bin/bash
set -euo pipefail
SRC=${1:-/tmp/0m1}
BASE=/root/opt/tgbot/tg-miniapp-loverussian
cd "$BASE"

cp -f "$SRC/scaleIdeasPack.js" backend/services/scaleIdeasPack.js
cp -f "$SRC/softHumanGates.js" backend/services/softHumanGates.js
cp -f "$SRC/softHumanLite.js" backend/services/softHumanLite.js
cp -f "$SRC/humanRhythm.js" backend/services/humanRhythm.js
cp -f "$SRC/nftCampaign.js" backend/services/nftCampaign.js
cp -f "$SRC/dailyLife.js" backend/services/dailyLife.js
cp -f "$SRC/leadScoring.js" backend/services/leadScoring.js
cp -f "$SRC/opsQuality.js" backend/services/opsQuality.js
cp -f "$SRC/helpRequestNotifier.js" backend/services/helpRequestNotifier.js
cp -f "$SRC/aiResponder.js" backend/services/aiResponder.js
cp -f "$SRC/adminConsoleStats.js" backend/services/adminConsoleStats.js
cp -f "$SRC/adminConsole.js" backend/routes/adminConsole.js
cp -f "$SRC/dashboard.js" backend/routes/dashboard.js
cp -f "$SRC/_smoke_wave_0m1.js" backend/scripts/_smoke_wave_0m1.js
cp -f "$SRC/_hard_audit_0m1.js" backend/scripts/_hard_audit_0m1.js
cp -f "$SRC/_hard_audit_full_0ht.js" backend/scripts/_hard_audit_full_0ht.js

cp -f "$SRC/index_frontend.html" frontend/index.html
cp -f "$SRC/app.js" frontend/app.js
cp -f "$SRC/styles.css" frontend/styles.css
cp -f "$SRC/updates_fe.js" frontend/updates.js
cp -f "$SRC/updates_ops.js" ops-console/app/updates.js
cp -f "$SRC/CHANGELOG_TG.md" CHANGELOG_TG.md

if grep -q 'операторская, вне Telegram' frontend/index.html; then
  echo REFUSE_FRONTEND_IS_OPS
  exit 1
fi
grep -q 'app-splash' frontend/index.html
grep -q 'updates.js?v=258' frontend/index.html
grep -q 'Радар админа и живее ответы' frontend/updates.js
grep -q '## 0m1\.' CHANGELOG_TG.md
grep -q "NFT_VOICE_FILE = 'nft.ogg'" backend/services/scaleIdeasPack.js
! grep -q 'nft_b.ogg' backend/services/scaleIdeasPack.js
! grep -q 'assignVoiceVariant' backend/services/nftCampaign.js
grep -q 'applyWave0m1Gates' backend/services/softHumanLite.js

(
  export OPENAI_API_KEY=sk-test
  unset AUDIT_SMOKE || true
  node backend/scripts/_smoke_wave_0m1.js
  node backend/scripts/_hard_audit_0m1.js
)

eval "$(python3 - <<'PY'
import re, shlex
from pathlib import Path
text = Path('backend/.env').read_text(encoding='utf-8', errors='ignore')
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
n=$(python3 - <<'PY'
import os
print(len([x for x in os.environ.get('PROXY_LIST','').split(';') if x.strip()]))
PY
)
echo "PROXY_LEN=$n"
[ "$n" -ge 5 ] || { echo REFUSE_PROXY; exit 1; }

pm2 restart tgbot --update-env
pm2 save
sleep 12
bash backend/scripts/_deploy_guard.sh
echo DEPLOY_0m1_OK
