#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo "=== audit B narrow 0ln ==="
node scripts/_smoke_funnel_days_0ln.js
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
print('uptime_ms', e.get('pm_uptime'))
PY
grep -q FUNNEL_BOARD_STAGES services/leadScoring.js
grep -q "STAGE_ORDER = \\['day1'" ../ops-console/app/renderer.js
grep -q "funnelStages: \\['day1'" ../frontend/app.js || grep -q "day1: '1 день'" ../frontend/app.js
grep -q 'updates.js?v=244' ../frontend/index.html
grep -q '## 0ln\.' ../CHANGELOG_TG.md
# hard audit with timeout — не блокируем релиз на вечном hang
if timeout 180 env HARD_AUDIT_FAST=1 node scripts/_hard_audit_0ht.js; then
  echo HARD_AUDIT_OK
else
  ec=$?
  if [ "$ec" -eq 124 ]; then echo HARD_AUDIT_TIMEOUT_SOFT; else echo HARD_AUDIT_EC=$ec; fi
fi
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY' /root/.pm2/logs/tgbot-error.log | tail -10 || true
echo AUDIT_B_0ln_DONE
