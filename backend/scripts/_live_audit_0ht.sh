#!/bin/bash
# Live VPS hard audit — logs + proxy + wiring on disk
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
echo "=== LIVE AUDIT 0ht ==="

echo "--- pm2 ---"
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
pl=(e.get('PROXY_LIST') or '')
print({'status':e['status'],'restarts':e.get('restart_time'),'PROXY':len([x for x in pl.split(';') if x.strip()]),'uptime_ms':e.get('pm_uptime')})
PY

echo "--- disk wiring ---"
grep -c activateInWaves "$BASE/backend/services/sessionBootstrap.js"
grep -c pickBusyDelayMs "$BASE/backend/services/inbound.js"
grep -c burstExtraDelayMs "$BASE/backend/services/replyPipeline.js"
grep -c breakShortAckEcho "$BASE/backend/services/softHumanLite.js"
grep -c getPoolRoleCounts "$BASE/backend/services/opsQuality.js"
grep -c persona-templates "$BASE/backend/routes/accounts.js"
grep -oE 'updates.js\?v=[0-9]+|app.js\?v=[0-9]+' "$BASE/frontend/index.html" | head -5
grep -n 'Масштаб: шаблоны' "$BASE/frontend/updates.js" | head -1
grep -n 'Масштаб: шаблоны' "$BASE/ops-console/app/updates.js" | head -1
test -f "$BASE/backend/services/scaleOps.js" && echo scaleOps_OK

echo "--- smoke on VPS ---"
cd "$BASE/backend"
node scripts/_smoke_scale_0ht.js
node scripts/_hard_audit_0ht.js

echo "--- out log greps ---"
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|Дайджест отсева|\[bootstrap\] волна|восстановлено «Занята»' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -35 || true
grep -aE 'outbound (voice|media|text)' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -15 || true

echo "--- err log ---"
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY|OPENAI|scaleOps|TypeError|Cannot find' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -25 || true

echo "--- recent replies sample ---"
grep -aE 'Ответ для' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -20 || true

echo "--- proxy pools ---"
python3 - <<'PY'
import re
from pathlib import Path
t=Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/.env').read_text(encoding='utf-8',errors='ignore')
m=re.search(r'^PROXY_LIST=(.*)$',t,re.M)
pl=(m.group(1).strip() if m else '')
print('env_PROXY', len([x for x in pl.split(';') if x.strip()]))
login=Path('/root/opt/tgbot/tg-miniapp-loverussian/backend/config/proxies-login.txt')
if login.exists():
  n=len([l for l in login.read_text(encoding='utf-8',errors='ignore').splitlines() if l.strip() and not l.startswith('#') and 'socks5' in l.lower()])
  print('login_proxies', n)
else:
  print('login_proxies', 0)
PY

echo LIVE_AUDIT_DONE
