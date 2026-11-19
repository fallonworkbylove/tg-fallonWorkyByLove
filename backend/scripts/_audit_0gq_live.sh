#!/bin/bash
set -euo pipefail
cd /root/opt/tgbot/tg-miniapp-loverussian/backend
echo '=== proxy ==='
pm2 jlist | python3 -c 'import json,sys; j=json.load(sys.stdin); p=[x for x in j if x["name"]=="tgbot"][0]; pl=p["pm2_env"].get("PROXY_LIST") or ""; print({"status":p["pm2_env"]["status"],"proxy":len([x for x in pl.split(";") if x.strip()])})'
grep -aE 'Warm TG:|Work \(DC\)' /root/.pm2/logs/tgbot-out.log | tail -3
echo '=== hard audit ==='
node scripts/_hard_audit_0gl.js 2>&1 | tail -40 || true
if [ -f scripts/_nightly_hard_audit.js ]; then
  node scripts/_nightly_hard_audit.js 2>&1 | tail -30 || true
fi
echo '=== live greps ==='
grep -aE 'ответил, сколько на дв|отсев \+ архив|AI замолчал|Дайджест отсева|outbound ' /root/.pm2/logs/tgbot-out.log | tail -25 || true
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY|SocksClientError' /root/.pm2/logs/tgbot-error.log | tail -15 || true
echo '=== sessions ==='
python3 - <<'PY'
t=open('/root/.pm2/logs/tgbot-out.log','rb').read().decode('utf-8','replace')[-30000:]
print('активирован', t.count('активирован'))
print('ошибка', t.count(': ошибка'))
print('завершен', t.count('завершен'))
print('Ответ', t.count('Ответ для'))
for line in t.splitlines():
    if 'Аккаунт' in line and ('активир' in line or 'ошибка' in line or 'сессия' in line):
        print(line[:200])
PY
echo AUDIT_0GQ_DONE
