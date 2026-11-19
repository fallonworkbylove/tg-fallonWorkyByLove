#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian

echo "=== FULL HARD C ==="
set +e
node backend/scripts/_hard_audit_full_0ht.js > /tmp/audit_c_final.txt 2>&1
EC=$?
set -e
echo "EXIT:$EC"
grep -E 'P0 |P1 |FULL_HARD|SCORE' /tmp/audit_c_final.txt || true
tail -20 /tmp/audit_c_final.txt

echo "=== ULTRA ==="
set +e
node backend/scripts/_ultra_hard_audit.js > /tmp/ultra_final.txt 2>&1
UE=$?
set -e
echo "ULTRA_EXIT:$UE"
tail -80 /tmp/ultra_final.txt

echo "=== LIVE ==="
grep -aE 'silence-heal:|waiting leads|outbound ' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -12 || true
grep -aE 'REFUSE_PROXY|PEER_ID_INVALID|FROZEN' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -8 || true

echo "=== PROXY ==="
pm2 jlist > /tmp/pm2j_final.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j_final.json'))
p=[x for x in j if x['name']=='tgbot'][0]
pl=p['pm2_env'].get('PROXY_LIST') or ''
print({'status': p['pm2_env']['status'], 'PROXY': len([x for x in pl.split(';') if x.strip()])})
PY

echo AUDIT_C_FINAL_DONE
