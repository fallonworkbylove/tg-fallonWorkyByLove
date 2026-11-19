#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo "=== audit B 0ln ==="
node scripts/_smoke_funnel_days_0ln.js
node scripts/_hard_audit_0ht.js || true
pm2 describe tgbot | head -20
python3 - <<'PY'
import re, json, subprocess
from pathlib import Path
t=Path('.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^PROXY_LIST=(.*)$',t,re.M)
pl=(m.group(1).strip() if m else '')
print('env_PROXY_LEN', len([x for x in pl.split(';') if 'socks5' in x]))
j=json.loads(subprocess.check_output(['pm2','jlist'], text=True))
e=j[0].get('pm2_env',{})
pl2=str(e.get('PROXY_LIST') or '')
print('pm2_status', e.get('status'), 'pm2_PROXY_LEN', len([x for x in pl2.split(';') if 'socks5' in x]))
PY
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY' /root/.pm2/logs/tgbot-error.log | tail -15 || true
grep -q FUNNEL_BOARD_STAGES services/leadScoring.js
grep -q "STAGE_ORDER = \\['day1'" ../ops-console/app/renderer.js
grep -q 'day1' ../frontend/app.js
echo AUDIT_B_0ln_DONE
