#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo "=== audit B 0lo ==="
node scripts/_smoke_wave_0lo.js
grep -q applyWave0loGates services/softHumanGates.js
grep -q runWaitingLeadsWatch services/opsQuality.js
grep -q circuit services/aiResponder.js
grep -q 'updates.js?v=245' ../frontend/index.html
python3 - <<'PY'
import json,subprocess
d=json.loads(subprocess.check_output(['pm2','jlist'],text=True))
e=[x for x in d if x.get('name')=='tgbot'][0]['pm2_env']
pl=[x for x in str(e.get('PROXY_LIST') or '').split(';') if 'socks5' in x]
print('pm2', e.get('status'), 'PROXY', len(pl))
assert e.get('status')=='online' and len(pl)>=5
PY
timeout 120s env HARD_AUDIT_FAST=1 node scripts/_hard_audit_0ht.js >/tmp/hard_0lo.txt 2>&1 || true
grep -q HARD_AUDIT_0HT_OK /tmp/hard_0lo.txt && echo HARD_OK || echo HARD_SOFT
echo AUDIT_B_0lo_DONE
