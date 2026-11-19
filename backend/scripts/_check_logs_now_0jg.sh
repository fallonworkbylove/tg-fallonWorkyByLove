#!/bin/bash
set -euo pipefail
echo "=== health ==="
curl -sS http://127.0.0.1:3000/api/health; echo
echo "=== pm2 ==="
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
n=len([x for x in (e.get('PROXY_LIST')or'').split(';') if x.strip()])
print({'status':e['status'],'PROXY':n,'restarts':e.get('restart_time')})
PY
echo "=== OUT (ответы/медиа/отсев/AI) ==="
grep -aE 'ответил|outbound |отсев \+|AI замолчал|skip reason|AUTH_KEY|Ошибка обработки' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -45 || true
echo "=== ERR ==="
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|OPENAI|REFUSE_PROXY|AUTH_KEY|Error|TypeError|Cannot' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -25 || true
echo "=== ERR tail raw ==="
tail -20 /root/.pm2/logs/tgbot-error.log 2>/dev/null || true
echo "=== recent replies sample ==="
grep -aE '→ "|ответил' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -20 || true
echo DONE_LOGS
