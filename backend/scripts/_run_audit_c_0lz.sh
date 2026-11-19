#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian

echo "=== FULL HARD C ==="
set +e
node backend/scripts/_hard_audit_full_0ht.js > /tmp/audit_c_0lz.txt 2>&1
EC=$?
set -e
echo "EXIT:$EC"
tail -40 /tmp/audit_c_0lz.txt
grep -E 'P0 |P1 |FULL_HARD' /tmp/audit_c_0lz.txt || true

echo "=== ULTRA ==="
set +e
node backend/scripts/_ultra_hard_audit.js > /tmp/ultra_0lz.txt 2>&1
UE=$?
set -e
echo "ULTRA_EXIT:$UE"
tail -50 /tmp/ultra_0lz.txt

echo "=== LIVE OUT ==="
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|outbound |silence-heal|waiting leads' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -20 || true

echo "=== LIVE ERR ==="
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY|APIConnection|Connection error' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -15 || true

echo "=== PROXY ==="
pm2 jlist > /tmp/pm2j_0lz.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j_0lz.json'))
p=[x for x in j if x['name']=='tgbot'][0]
pl=p['pm2_env'].get('PROXY_LIST') or ''
print({'status': p['pm2_env']['status'], 'PROXY': len([x for x in pl.split(';') if x.strip()])})
PY

echo AUDIT_C_0LZ_DONE
