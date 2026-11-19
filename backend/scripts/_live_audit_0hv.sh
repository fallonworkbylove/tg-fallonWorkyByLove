#!/bin/bash
set -euo pipefail
BASE=/root/opt/tgbot/tg-miniapp-loverussian
echo "=== LIVE AUDIT 0hv ==="
pm2 jlist > /tmp/pm2j.json
python3 - <<'PY'
import json
j=json.load(open('/tmp/pm2j.json'))
p=[x for x in j if x['name']=='tgbot'][0]
e=p['pm2_env']
pl=e.get('PROXY_LIST') or ''
print({'status':e['status'],'PROXY':len([x for x in pl.split(';') if x.strip()])})
PY
grep -oE 'updates.js\?v=[0-9]+|app.js\?v=[0-9]+' "$BASE/frontend/index.html" | head -5
grep -n 'Медиа после паузы' "$BASE/frontend/updates.js" | head -1
grep -n 'Медиа после паузы' "$BASE/ops-console/app/updates.js" | head -1
grep -c mediaDebt "$BASE/backend/services/replyPipeline.js"
grep -c worker-tasks-list "$BASE/frontend/index.html"
cd "$BASE/backend"
node scripts/_smoke_help_0hv.js
cp -a /tmp/0hv/_hard_audit_0hv.js scripts/ 2>/dev/null || true
[ -f scripts/_hard_audit_0hv.js ] && node scripts/_hard_audit_0hv.js || echo 'hard_0hv_skip'
echo "--- logs ---"
grep -aE 'AI замолчал|отсев \+ архив|\[bootstrap\] волна|mediaDebt|Филлер вместо медиа' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -20 || true
grep -aE 'PEER_ID_INVALID|FROZEN_METHOD|REFUSE_PROXY|TypeError|Cannot find' /root/.pm2/logs/tgbot-error.log 2>/dev/null | tail -15 || true
grep -aE 'Ответ для' /root/.pm2/logs/tgbot-out.log 2>/dev/null | tail -12 || true
echo LIVE_0HV_DONE
