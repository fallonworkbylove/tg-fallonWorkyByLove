#!/bin/bash
set -e
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo "=== ERR ==="
grep -aE 'TypeError|ReferenceError|packed_things|REFUSE_PROXY' /root/.pm2/logs/tgbot-error.log | tail -15 || true
echo "=== PROXY ==="
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; print(p["pm2_env"]["status"], len([x for x in pl.split(";") if x.strip()]))'
echo "=== SMOKE ==="
node scripts/_smoke_packed_things_0iq.js
echo "=== HARD ==="
node scripts/_hard_audit_0ht.js
echo "=== FULL ==="
node scripts/_hard_audit_full_0ht.js
echo "DONE_AUDIT_0iq"
