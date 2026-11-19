#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian

# Hotfix for night-aware busy gate (no full restart needed for scripts)
cp -f /tmp/0m0/_hard_audit_0ht.js backend/scripts/_hard_audit_0ht.js 2>/dev/null || true
cp -f /tmp/0m0/_hard_audit_full_0ht.js backend/scripts/_hard_audit_full_0ht.js 2>/dev/null || true

echo "=== FULL HARD C ==="
set +e
node backend/scripts/_hard_audit_full_0ht.js > /tmp/audit_c_0m0.txt 2>&1
EC=$?
set -e
echo "EXIT:$EC"
grep -E 'P0 |P1 |FULL_HARD|SCORE|soft' /tmp/audit_c_0m0.txt || true
tail -25 /tmp/audit_c_0m0.txt

echo "=== ULTRA ==="
set +e
node backend/scripts/_ultra_hard_audit.js > /tmp/ultra_0m0.txt 2>&1
UE=$?
set -e
echo "ULTRA_EXIT:$UE"
tail -60 /tmp/ultra_0m0.txt

echo "=== PROXY ==="
pm2 jlist > /tmp/pm2j_0m0.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j_0m0.json'))
p=[x for x in j if x['name']=='tgbot'][0]
pl=p['pm2_env'].get('PROXY_LIST') or ''
print({'status': p['pm2_env']['status'], 'PROXY': len([x for x in pl.split(';') if x.strip()])})
PY

echo AUDIT_C_0M0_DONE
