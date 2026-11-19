#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
PID=$(pm2 pid tgbot)
START=$(ps -p "$PID" -o lstart=)
echo "pid=$PID started=$START"

# Count how many NEW errors after our mark if any
echo "=== ERR after last helpRequest / recent unique ==="
# Show only lines that are NOT the ancient block: take last 30 lines of err file
tail -30 /root/.pm2/logs/tgbot-error.log | grep -v telegramAuth || true

echo
echo "=== OUT last 40 (live) ==="
pm2 logs tgbot --out --lines 40 --nostream 2>/dev/null | tail -40

echo
echo "=== HARD A/B ==="
AS=$(date -u -d "$(ps -p "$PID" -o lstart=)" +'%Y-%m-%d %H:%M:%S' 2>/dev/null || date -u +'%Y-%m-%d %H:%M:%S' -d '20 minutes ago')
echo "AUDIT_SINCE=$AS"
AUDIT_FIX_SINCE="$AS" node scripts/_ultra_hard_audit.js > /tmp/ha.txt || true
AUDIT_FIX_SINCE="$AS" node scripts/_ultra_hard_audit.js > /tmp/hb.txt || true
python3 - <<'PY'
import json
def load(p):
  t=open(p,encoding='utf-8').read()
  return json.loads(t[t.find('{'):t.rfind('}')+1])
for name in ['ha','hb']:
  o=load(f'/tmp/{name}.txt')
  fails=[f"{k}:{c['name']} {c.get('detail','')}" for k,arr in o.get('checks_detail',{}).items() for c in arr if not c['pass']]
  print(name, 'overall', o['overall'], 'checks', o['checks'], 'findings', o['findings'], 'fails', fails)
PY
echo DONE
